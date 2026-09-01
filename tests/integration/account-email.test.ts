import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users, verificationTokens } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import { hashToken } from "@/lib/security/tokens";
import {
  AuthError,
  confirmEmailChange,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
} from "@/modules/auth/service";
import { createSession, resolveSession } from "@/modules/auth/sessions";
import { hashPassword } from "@/modules/auth/passwords";

/**
 * The two flows that leave the application and come back through an inbox.
 *
 * Both are only as good as what is actually in the message, so the mailer is
 * captured rather than stubbed away: these tests read the link out of the sent
 * body and use it, which is the closest thing to being the recipient. The rest
 * of the suite runs with no SMTP configured, so the environment is switched on
 * here and put back afterwards.
 */

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

const PASSWORD = "quiet-lantern-drifts-42";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

/**
 * An account with a password, written directly.
 *
 * `registerUser` would do it, but with SMTP on it also withholds the session
 * and mails a verification — neither of which is what these tests are about.
 */
async function createPasswordUser(
  email = uniqueEmail("account"),
): Promise<{ userId: string; email: string }> {
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

/** The token out of the one link in a message body. */
function linkToken(body: string): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(body);
  if (!match) throw new Error(`No token in mail body: ${body}`);
  return match[1];
}

beforeEach(() => {
  sent.length = 0;
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_FROM = "balancia@example.test";
  resetEnvCache();
});

afterEach(() => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM;
  resetEnvCache();
});

describe("resetting a forgotten password", () => {
  it("mails a link that sets a new password and ends every session", async () => {
    const account = await createPasswordUser();
    const before = await createSession(account.userId);

    await requestPasswordReset(account.email);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(account.email);
    expect(sent[0].text).toContain("/reset-password?token=");

    const token = linkToken(sent[0].text);
    expect(await resetPassword(token, "a-brand-new-password")).toBe(true);

    // The point of the flow: the new password works, the old one does not, and
    // anyone holding a session from before is out.
    const signedIn = await signInWithPassword({
      email: account.email,
      password: "a-brand-new-password",
    });
    expect(signedIn.user.userId).toBe(account.userId);
    await expect(
      signInWithPassword({ email: account.email, password: PASSWORD }),
    ).rejects.toThrow(AuthError);
    expect(await resolveSession(before.token)).toBeNull();
  });

  it("stores only the hash of the emailed token", async () => {
    const account = await createPasswordUser();
    await requestPasswordReset(account.email);
    const token = linkToken(sent[0].text);

    const rows = await getDb()
      .select()
      .from(verificationTokens)
      .where(eq(verificationTokens.userId, account.userId));

    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(rows[0].tokenHash).not.toBe(token);
  });

  it("spends the link once", async () => {
    const account = await createPasswordUser();
    await requestPasswordReset(account.email);
    const token = linkToken(sent[0].text);

    expect(await resetPassword(token, "a-brand-new-password")).toBe(true);
    expect(await resetPassword(token, "another-password-entirely")).toBe(false);
  });

  it("refuses an expired link", async () => {
    const account = await createPasswordUser();
    await requestPasswordReset(account.email);
    const token = linkToken(sent[0].text);

    await getDb()
      .update(verificationTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verificationTokens.tokenHash, hashToken(token)));

    expect(await resetPassword(token, "a-brand-new-password")).toBe(false);
  });

  it("supersedes an earlier link when a second is asked for", async () => {
    const account = await createPasswordUser();
    await requestPasswordReset(account.email);
    const first = linkToken(sent[0].text);
    await requestPasswordReset(account.email);
    const second = linkToken(sent[1].text);

    expect(await resetPassword(first, "a-brand-new-password")).toBe(false);
    expect(await resetPassword(second, "a-brand-new-password")).toBe(true);
  });

  it("says nothing and mails nobody for an address with no account", async () => {
    // Succeeding either way is what keeps this from being a way to ask whether
    // an address is registered.
    await expect(
      requestPasswordReset(uniqueEmail("stranger")),
    ).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("is offered only where there is a mail server", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    resetEnvCache();

    await expect(requestPasswordReset(uniqueEmail("nomail"))).rejects.toThrow(
      AuthError,
    );
  });
});

describe("changing the address on an account", () => {
  it("warns the old address before it mails the new one", async () => {
    const account = await createPasswordUser();
    const target = uniqueEmail("moved");

    await requestEmailChange(account.userId, target);

    expect(sent).toHaveLength(2);
    // Order matters: the notice is the one that must not be skipped, so it
    // goes first and a failure to deliver it stops the confirmation.
    expect(sent[0].to).toBe(account.email);
    expect(sent[0].text).toContain(target);
    expect(sent[0].text).not.toContain("/confirm-email");
    expect(sent[1].to).toBe(target);
    expect(sent[1].text).toContain("/confirm-email?token=");
  });

  it("moves the account only once the link is opened", async () => {
    const account = await createPasswordUser();
    const target = uniqueEmail("moved");

    await requestEmailChange(account.userId, target);

    // Still the old address, and still usable, until the link is opened.
    const stillOld = await signInWithPassword({
      email: account.email,
      password: PASSWORD,
    });
    expect(stillOld.user.email).toBe(account.email);

    expect(await confirmEmailChange(linkToken(sent[1].text))).toBe("changed");

    const [row] = await getDb()
      .select({ email: users.email, verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, account.userId));
    expect(row.email).toBe(target);
    // Opening the link is the proof a separate verification would have asked
    // for, so the new address arrives verified.
    expect(row.verifiedAt).not.toBeNull();

    const signedIn = await signInWithPassword({
      email: target,
      password: PASSWORD,
    });
    expect(signedIn.user.userId).toBe(account.userId);
    await expect(
      signInWithPassword({ email: account.email, password: PASSWORD }),
    ).rejects.toThrow(AuthError);
  });

  it("spends the link once", async () => {
    const account = await createPasswordUser();
    await requestEmailChange(account.userId, uniqueEmail("moved"));
    const token = linkToken(sent[1].text);

    expect(await confirmEmailChange(token)).toBe("changed");
    expect(await confirmEmailChange(token)).toBe("invalid");
  });

  it("refuses a malformed or unknown link", async () => {
    expect(await confirmEmailChange("not-a-token")).toBe("invalid");
    expect(await confirmEmailChange("a".repeat(43))).toBe("invalid");
  });

  it("refuses the address the account already has, in any casing", async () => {
    const account = await createPasswordUser(uniqueEmail("Same").toLowerCase());

    await expect(
      requestEmailChange(account.userId, account.email.toUpperCase()),
    ).rejects.toThrow(AuthError);
    expect(sent).toHaveLength(0);
  });

  it("refuses an address another account already has", async () => {
    const account = await createPasswordUser();
    const other = await createPasswordUser();

    await expect(
      requestEmailChange(account.userId, other.email),
    ).rejects.toThrow(AuthError);
    expect(sent).toHaveLength(0);
  });

  it("reports the race where the address is claimed before the link is opened", async () => {
    const account = await createPasswordUser();
    const target = uniqueEmail("contested");
    await requestEmailChange(account.userId, target);
    const token = linkToken(sent[1].text);

    // Somebody else registers it while the link sits in an inbox. The unique
    // index is the authority, not the check made at request time.
    await createPasswordUser(target);

    expect(await confirmEmailChange(token)).toBe("taken");
    const [row] = await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, account.userId));
    expect(row.email).toBe(account.email);
  });

  it("supersedes an earlier request when a second is made", async () => {
    const account = await createPasswordUser();
    await requestEmailChange(account.userId, uniqueEmail("first"));
    const first = linkToken(sent[1].text);
    const second = uniqueEmail("second");
    await requestEmailChange(account.userId, second);
    const live = linkToken(sent[3].text);

    expect(await confirmEmailChange(first)).toBe("invalid");
    expect(await confirmEmailChange(live)).toBe("changed");

    const [row] = await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, account.userId));
    expect(row.email).toBe(second);
  });

  it("keeps the pending address on the token, not on the account", async () => {
    const account = await createPasswordUser();
    const target = uniqueEmail("pending");
    await requestEmailChange(account.userId, target);

    const [row] = await getDb()
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.userId, account.userId),
          eq(verificationTokens.purpose, "email_change"),
        ),
      );
    expect(row.newEmail).toBe(target);
    expect(row.tokenHash).toBe(hashToken(linkToken(sent[1].text)));
  });

  it("is offered only where there is a mail server", async () => {
    const account = await createPasswordUser();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    resetEnvCache();

    await expect(
      requestEmailChange(account.userId, uniqueEmail("nomail")),
    ).rejects.toThrow(AuthError);
    expect(sent).toHaveLength(0);
  });
});
