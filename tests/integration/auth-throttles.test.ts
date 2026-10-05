import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { IntlMessageFormat } from "intl-messageformat";
import { getDb } from "@/lib/db/client";
import { users, verificationTokens } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import {
  enforcePasswordSignInLimits,
  RateLimitedError,
} from "@/lib/security/rate-limit";
import { hashPassword, verifyPassword } from "@/modules/auth/passwords";
import { resetPassword } from "@/modules/auth/service";
import { createSession, SESSION_COOKIE_NAME } from "@/modules/auth/sessions";
import { signInWithCode } from "@/modules/auth/signup";
import en from "../../messages/en.json";

/**
 * The limits in front of the credential doors, through the doors themselves.
 *
 * These go through the Server Actions and the mobile route rather than the
 * services underneath, because what is being protected is the wiring: a
 * bucket that exists and is spent by nobody is the failure this file is here
 * to catch. The request is faked at the edge Next.js would supply — headers,
 * cookies, `after()` — and everything behind that is real, the client address
 * included, read out of `X-Forwarded-For` the way a proxy would hand it over.
 */

const request = vi.hoisted(() => ({
  headers: new Headers(),
  cookies: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => {
      const value = request.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      request.cookies.set(name, value);
    },
    delete: (name: string) => {
      request.cookies.delete(name);
    },
  }),
}));

/** What was handed to `after()`, held until the test says the answer has gone. */
const deferred = vi.hoisted(() => [] as (() => unknown)[]);

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    deferred.push(task);
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

/** The real catalogue, so a refusal reads as the sentence a person would see. */
vi.mock("next-intl/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl/server")>()),
  getTranslations: async (namespace: string) => {
    const messages = (en as unknown as Record<string, Record<string, string>>)[
      namespace
    ];
    const t = (key: string, values?: Record<string, unknown>) =>
      new IntlMessageFormat(messages[key], "en").format(values) as string;
    t.has = (key: string) => key in messages;
    return t;
  },
}));

const sent = vi.hoisted(
  () => [] as { to: string; subject: string; text: string }[],
);

vi.mock("@/modules/auth/mailer", () => ({
  sendMail: vi.fn(async (message: (typeof sent)[number]) => {
    sent.push(message);
  }),
  isMailEnabled: () => true,
  resetMailer: () => {},
}));

const actions = await import("@/modules/auth/actions");
const sessionRoute = await import("@/app/api/auth/session/route");

const PASSWORD = "quiet-lantern-drifts-42";
const WRONG = "not-the-password-at-all";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

/** The next request arrives from this address, as the proxy saw it. */
function from(address: string): void {
  request.headers = new Headers({ "x-forwarded-for": address });
}

/** Runs what the request left for after its response, as Next.js would. */
async function afterTheResponse(): Promise<void> {
  while (deferred.length > 0) {
    await deferred.shift()?.();
  }
}

async function createPasswordUser(): Promise<{
  userId: string;
  email: string;
}> {
  const email = uniqueEmail("account");
  const [row] = await getDb()
    .insert(users)
    .values({
      email,
      name: "Account Holder",
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id });
  return { userId: row.id, email };
}

async function tokensFor(userId: string) {
  return getDb()
    .select({ id: verificationTokens.id })
    .from(verificationTokens)
    .where(eq(verificationTokens.userId, userId));
}

const SAVED_AUTH_MAX = process.env.AUTH_RATE_LIMIT_MAX;

/** What a refusal from an hour-long bucket says at half past. */
const REFUSED = "Too many attempts. Try again in 30 minutes.";

beforeEach(() => {
  // Every count below is the built-in one. A shell that exported a raised
  // ceiling for some other suite must not quietly change what is asserted.
  delete process.env.AUTH_RATE_LIMIT_MAX;
  resetEnvCache();
  request.headers = new Headers();
  request.cookies.clear();
  deferred.length = 0;
  sent.length = 0;

  // Half past this hour, and held there. Every window here starts on the
  // hour, and a test that ran across one would watch its count start again
  // halfway through; a still clock also makes the wait a refusal names
  // something that can be written down.
  const halfPast = new Date();
  halfPast.setUTCMinutes(30, 0, 0);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(halfPast);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  if (SAVED_AUTH_MAX === undefined) delete process.env.AUTH_RATE_LIMIT_MAX;
  else process.env.AUTH_RATE_LIMIT_MAX = SAVED_AUTH_MAX;
  resetEnvCache();
});

describe("guessing one account's password from many places", () => {
  /*
   * Twenty wrong passwords, each from an address nobody has used before —
   * which `signIn`, counting per address, never sees as more than one. The
   * twenty-first is refused even though it is the right password, because
   * the refusal comes before any password is checked.
   */
  it("refuses the twenty-first, and answers an address with no account the same", async () => {
    const account = await createPasswordUser();
    const nobody = uniqueEmail("nobody");

    async function guess(email: string, network: number) {
      const answers = [];
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        from(`10.${network}.0.${attempt}`);
        answers.push(await actions.signInAction({ email, password: WRONG }));
      }
      from(`10.${network}.1.1`);
      answers.push(await actions.signInAction({ email, password: PASSWORD }));
      return answers;
    }

    const real = await guess(account.email, 1);
    const invented = await guess(nobody, 2);

    expect(real.slice(0, 20)).toEqual(
      Array(20).fill({ ok: false, error: en.serverErrors.invalidCredentials }),
    );
    expect(real[20]).toEqual({ ok: false, error: REFUSED });
    expect(request.cookies.has(SESSION_COOKIE_NAME)).toBe(false);

    // Word for word, on the same attempt: the limit says nothing about who
    // has an account.
    expect(invented).toEqual(real);
  });

  it("holds the mobile session route to the same count", async () => {
    const account = await createPasswordUser();
    const post = (password: string) =>
      sessionRoute.POST(
        new Request("http://localhost/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: account.email, password }),
        }),
      );

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      from(`10.3.0.${attempt}`);
      expect((await post(WRONG)).status).toBe(401);
    }

    from("10.3.1.1");
    const refused = await post(PASSWORD);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("1800");
    expect(await refused.json()).toEqual({ error: REFUSED });
  });

  it("counts the address typed case-insensitively", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const typed =
        attempt % 2 === 0 ? "Ada@Example.Test" : " ada@example.test";
      await enforcePasswordSignInLimits(`10.4.${attempt}.1`, typed);
    }
    await expect(
      enforcePasswordSignInLimits("10.4.99.1", "ADA@EXAMPLE.TEST"),
    ).rejects.toThrow(RateLimitedError);
  });

  it("is raised by AUTH_RATE_LIMIT_MAX like every credential bucket", async () => {
    process.env.AUTH_RATE_LIMIT_MAX = "25";
    resetEnvCache();

    for (let attempt = 0; attempt < 25; attempt += 1) {
      await enforcePasswordSignInLimits(
        `10.5.${attempt}.1`,
        "ada@example.test",
      );
    }
    await expect(
      enforcePasswordSignInLimits("10.5.99.1", "ada@example.test"),
    ).rejects.toThrow(RateLimitedError);
  });
});

describe("an IPv6 client", () => {
  it("spends one allowance for its whole /64, however it rotates", async () => {
    // Ten a client, and every attempt at a different account so only the
    // per-client bucket is in play.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await enforcePasswordSignInLimits(
        `2001:db8:1:2::${attempt.toString(16)}`,
        `nobody-${attempt}@example.test`,
      );
    }
    await expect(
      enforcePasswordSignInLimits(
        "2001:db8:1:2:dead:beef:0:1",
        "nobody-11@example.test",
      ),
    ).rejects.toThrow(RateLimitedError);

    // The next /64 along is somebody else.
    await expect(
      enforcePasswordSignInLimits("2001:db8:1:3::1", "nobody-12@example.test"),
    ).resolves.toBeUndefined();

    const { rows } = await getDb().execute(
      sql`SELECT DISTINCT bucket FROM rate_limits WHERE bucket LIKE 'signIn:%'`,
    );
    expect(
      rows.map((row) => (row as { bucket: string }).bucket).sort(),
    ).toEqual(["signIn:2001:db8:1:2::/64", "signIn:2001:db8:1:3::/64"]);
  });
});

describe("changing a password", () => {
  it("stops a session guessing at the current password after ten tries", async () => {
    const account = await createPasswordUser();
    const session = await createSession(account.userId);
    request.cookies.set(SESSION_COOKIE_NAME, session.token);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        await actions.changePasswordAction({
          currentPassword: WRONG,
          newPassword: "a-brand-new-password",
        }),
      ).toEqual({ ok: false, error: en.serverErrors.wrongPassword });
    }

    expect(
      await actions.changePasswordAction({
        currentPassword: PASSWORD,
        newPassword: "a-brand-new-password",
      }),
    ).toEqual({ ok: false, error: REFUSED });

    // Refused before anything was checked, so nothing was changed either.
    const [row] = await getDb()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, account.userId));
    expect(await verifyPassword(PASSWORD, row.passwordHash ?? "")).toBe(true);
  });
});

describe("mail sent to an address somebody typed", () => {
  beforeEach(() => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_FROM = "balancia@example.test";
    resetEnvCache();
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    resetEnvCache();
  });

  /** The token out of the one link in a message body. */
  function linkToken(body: string): string {
    const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(body);
    if (!match) throw new Error(`No token in mail body: ${body}`);
    return match[1];
  }

  it("answers a reset request before a token exists, and mails after", async () => {
    const account = await createPasswordUser();
    from("198.51.100.1");

    expect(
      await actions.requestPasswordResetAction({ email: account.email }),
    ).toEqual({ ok: true });
    // Nothing that only an account gets has happened yet — which is what
    // makes this answer take as long as the one for an unknown address.
    expect(sent).toHaveLength(0);
    expect(await tokensFor(account.userId)).toHaveLength(0);

    await afterTheResponse();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(account.email);
    expect(await tokensFor(account.userId)).toHaveLength(1);
  });

  it("stops at three reset links an hour, keeping the last one live", async () => {
    const account = await createPasswordUser();

    // Each from a new address, which is the shape the per-caller bucket
    // cannot see.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      from(`198.51.100.${attempt}`);
      await actions.requestPasswordResetAction({ email: account.email });
      await afterTheResponse();
    }
    expect(sent).toHaveLength(3);
    const live = linkToken(sent[2].text);

    from("198.51.100.99");
    expect(
      await actions.requestPasswordResetAction({ email: account.email }),
    ).toEqual({ ok: true });
    expect(deferred).toHaveLength(0);
    await afterTheResponse();

    // Nothing sent, and nothing superseded: the owner's link still works.
    expect(sent).toHaveLength(3);
    expect(await resetPassword(live, "a-brand-new-password")).toBe(true);
  });

  it("answers the same for an address with no account, past its share too", async () => {
    const nobody = uniqueEmail("nobody");

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      from(`198.51.100.${attempt}`);
      expect(
        await actions.requestPasswordResetAction({ email: nobody }),
      ).toEqual({ ok: true });
    }
    await afterTheResponse();
    expect(sent).toHaveLength(0);
  });

  it("mails a sign-in code after the answer, three an hour, keeping the last live", async () => {
    const account = await createPasswordUser();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      from(`198.51.100.${attempt}`);
      expect(
        await actions.requestSignInCodeAction({ email: account.email }),
      ).toEqual({ ok: true });
      expect(sent).toHaveLength(attempt - 1);
      await afterTheResponse();
      expect(sent).toHaveLength(attempt);
    }
    const code = /^(\d{6})\b/.exec(sent[2].subject)?.[1] ?? "";

    from("198.51.100.99");
    expect(
      await actions.requestSignInCodeAction({ email: account.email }),
    ).toEqual({ ok: true });
    expect(deferred).toHaveLength(0);
    expect(sent).toHaveLength(3);

    const signedIn = await signInWithCode({ email: account.email, code });
    expect(signedIn.user.userId).toBe(account.userId);
  });
});
