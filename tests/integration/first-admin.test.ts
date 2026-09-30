import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import { registerUser, signInWithApple } from "@/modules/auth/service";
import {
  finishPasskeySignup,
  startCodeSignup,
  startPasskeySignup,
} from "@/modules/auth/signup";
import { register } from "../helpers/webauthn";

/**
 * Who becomes the instance administrator when the first signups race.
 *
 * The first account on an instance is its administrator
 * (src/lib/security/admin.ts). That used to be decided inside the INSERT, as
 * `NOT EXISTS (SELECT 1 FROM users)`, which under READ COMMITTED reads a
 * snapshot taken as the statement starts: two registrations whose INSERTs
 * overlapped on an empty instance could each see nobody and each take the
 * flag. It was also only as good as the paths that remembered to say it, and
 * Sign in with Apple did not. The rule is now a trigger on `users`
 * (drizzle/0039_first_account_is_admin.sql), which queues an INSERT into an
 * empty table behind any other still in flight.
 *
 * The overlap is not left to timing. The first signup is held open between
 * its user row and its passkey — the one place a real signup keeps a user row
 * uncommitted while it does something else — until the second has either
 * finished or been seen waiting, and only then allowed to end.
 */

const PASSWORD = "quiet lantern drifts 42";

/** Stops a passkey signup after its user row, before its credential. */
const hold = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  reached: () => {},
}));

vi.mock("@/modules/auth/webauthn", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/auth/webauthn")>();
  return {
    ...actual,
    insertPasskey: async (
      ...args: Parameters<typeof actual.insertPasskey>
    ): ReturnType<typeof actual.insertPasskey> => {
      if (hold.gate) {
        hold.reached();
        await hold.gate;
      }
      return actual.insertPasskey(...args);
    },
  };
});

vi.mock("@/modules/auth/mailer", () => ({
  sendMail: vi.fn(async () => undefined),
}));

function withSmtp(enabled: boolean): void {
  if (enabled) {
    process.env.SMTP_HOST = "localhost";
    process.env.SMTP_PORT = "1025";
    process.env.SMTP_FROM = "balancia@example.test";
  } else {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;
  }
  resetEnvCache();
}

afterEach(() => {
  hold.gate = null;
  withSmtp(false);
});

async function administrators(): Promise<string[]> {
  const rows = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.isAdmin, true))
    .orderBy(users.email);
  return rows.map((row) => row.email);
}

/** Whether any session is queued for a lock another one holds. */
async function somebodyIsWaiting(): Promise<boolean> {
  const { rows } = await getPool().query<{ waiting: number }>(
    "SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted",
  );
  return rows[0]!.waiting > 0;
}

/** A passkey signup, start to finish, the way the browser would make one. */
async function passkeySignup(email: string, name: string) {
  const options = await startPasskeySignup({ email, name });
  const { response } = register(options, { userVerified: true });
  return finishPasskeySignup(response);
}

function appleIdentity(email: string) {
  return {
    subject: `001234.${randomUUID()}.0000`,
    email,
    emailVerified: true,
    isPrivateEmail: false,
  };
}

/**
 * Starts Ada's passkey signup and returns once her row is written and her
 * transaction is still open, with the way to end it.
 */
async function adaHeldOpen() {
  let commit!: () => void;
  let abort!: (reason: Error) => void;
  hold.gate = new Promise<void>((resolve, reject) => {
    commit = resolve;
    abort = reject;
  });
  const reached = new Promise<void>((resolve) => {
    hold.reached = resolve;
  });

  const signup = passkeySignup("ada@example.test", "Ada");
  // Observed either way, so a failure before the gate is not an unhandled
  // rejection while `reached` is being waited for.
  signup.catch(() => undefined);
  await Promise.race([reached, signup]);
  hold.gate = null;
  return { signup, commit, abort };
}

/**
 * Waits until `pending` has settled or is queued behind a lock, then runs
 * `end` — always, so a failed wait cannot leave a transaction open.
 */
async function whenSettledOrWaiting(
  pending: Promise<unknown>,
  end: () => void,
): Promise<void> {
  let settled = false;
  pending.then(
    () => (settled = true),
    () => (settled = true),
  );
  try {
    await vi.waitFor(
      async () => {
        expect(settled || (await somebodyIsWaiting())).toBe(true);
      },
      { timeout: 10_000, interval: 20 },
    );
  } finally {
    end();
  }
}

describe("two first signups that overlap", () => {
  it("make exactly one administrator, the one that committed first", async () => {
    const ada = await adaHeldOpen();

    // Grace registers with a password while Ada's row is still uncommitted.
    const grace = registerUser({
      name: "Grace",
      email: "grace@example.test",
      password: PASSWORD,
    });
    await whenSettledOrWaiting(grace, ada.commit);

    await Promise.all([ada.signup, grace]);
    expect(await administrators()).toEqual(["ada@example.test"]);
  });

  it("leave the flag to the second when the first rolls back", async () => {
    const ada = await adaHeldOpen();

    const grace = registerUser({
      name: "Grace",
      email: "grace@example.test",
      password: PASSWORD,
    });
    await whenSettledOrWaiting(grace, () =>
      ada.abort(new Error("the authenticator went away")),
    );

    await expect(ada.signup).rejects.toThrow("the authenticator went away");
    await grace;
    expect(await administrators()).toEqual(["grace@example.test"]);
  });
});

describe("every kind of first signup at once", () => {
  it("makes exactly one of them the administrator", async () => {
    // The code signup mails its code, so it only exists with a mail server.
    withSmtp(true);

    await Promise.all([
      registerUser({
        name: "Ada",
        email: "ada@example.test",
        password: PASSWORD,
      }),
      registerUser({
        name: "Alan",
        email: "alan@example.test",
        password: PASSWORD,
      }),
      startCodeSignup({ email: "grace@example.test", name: "Grace" }),
      startCodeSignup({ email: "gordon@example.test", name: "Gordon" }),
      passkeySignup("hedy@example.test", "Hedy"),
      passkeySignup("herman@example.test", "Herman"),
      signInWithApple(appleIdentity("katherine@example.test")),
      signInWithApple(appleIdentity("ken@example.test")),
    ]);

    const everybody = await getDb().select({ id: users.id }).from(users);
    expect(everybody).toHaveLength(8);
    expect(await administrators()).toHaveLength(1);
  });
});

describe("the first account", () => {
  it("is the administrator when it arrives through Apple", async () => {
    // Apple's signup writes its own row rather than going through
    // `insertUser`, and until the rule moved into the database it never
    // said anything about the flag.
    await signInWithApple(appleIdentity("ada@example.test"));
    await registerUser({
      name: "Grace",
      email: "grace@example.test",
      password: PASSWORD,
    });

    expect(await administrators()).toEqual(["ada@example.test"]);
  });

  it("is the administrator whatever writes it", async () => {
    // A row written with no word about the flag at all, the way a fixture or
    // a one-off script would: the rule belongs to the table, not the caller.
    await getDb()
      .insert(users)
      .values([
        { email: "ada@example.test", name: "Ada" },
        { email: "grace@example.test", name: "Grace" },
      ]);

    expect(await administrators()).toEqual(["ada@example.test"]);
  });

  it("does not stop an operator promoting a second administrator", async () => {
    // More than one administrator is allowed, which is why this is a lock
    // around the first INSERT and not a unique index on the flag.
    await registerUser({
      name: "Ada",
      email: "ada@example.test",
      password: PASSWORD,
    });
    const grace = await registerUser({
      name: "Grace",
      email: "grace@example.test",
      password: PASSWORD,
    });
    await getDb()
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.id, grace.user.userId));

    expect(await administrators()).toEqual([
      "ada@example.test",
      "grace@example.test",
    ]);
  });
});
