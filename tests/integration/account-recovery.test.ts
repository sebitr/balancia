import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { oauthIdentities, passkeys, users } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import { createApiToken, resolveApiToken } from "@/modules/api-tokens/service";
import {
  confirmEmailChange,
  linkAppleIdentity,
  registerUser,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
  verifyEmail,
} from "@/modules/auth/service";
import { createSession, resolveSession } from "@/modules/auth/sessions";
import { hashPassword } from "@/modules/auth/passwords";
import {
  finishPasskeySignup,
  requestSignInCode,
  signInWithCode,
  startPasskeySignup,
} from "@/modules/auth/signup";
import {
  finishPasskeyAuthentication,
  insertPasskey,
  startPasskeyAuthentication,
  type VerifiedRegistration,
} from "@/modules/auth/webauthn";
import { assert, register, type SoftCredential } from "../helpers/webauthn";

/**
 * Taking an account back through its inbox, and what that takes away.
 *
 * A passkey signup takes the address on trust, so a stranger can register
 * somebody else's and sign in to it with their own authenticator. The owner's
 * way in is recovery — a reset link or a sign-in code — and until this was
 * fixed both let them in while leaving the stranger's passkey, Apple link and
 * API keys exactly where they were, on what was by then a verified account.
 *
 * The rule now: the first proof of an address removes every credential that
 * came before it. A reset on an address that was already proved keeps the
 * owner's passkeys, and still ends everything a borrowed session can leave
 * behind — sessions, API keys, a pending email change.
 *
 * The passkeys here are real ceremonies against a software authenticator
 * (`tests/helpers/webauthn.ts`), so the signature, the challenge and the
 * user-verification flag are all checked the way a browser's would be.
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

/** The token out of the last link mailed to an address. */
function lastLinkTo(email: string): string {
  const message = sent.filter((m) => m.to === email).at(-1);
  const match = message && /[?&]token=([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match) throw new Error(`No link mailed to ${email}`);
  return match[1]!;
}

/** The six digits out of the last code mailed to an address. */
function lastCodeTo(email: string): string {
  const message = sent.filter((m) => m.to === email).at(-1);
  const match = message && /^(\d{6})\b/.exec(message.subject);
  if (!match) throw new Error(`No code mailed to ${email}`);
  return match[1]!;
}

/** A passkey signup, start to finish, the way the browser would make one. */
async function passkeySignup(email: string) {
  const options = await startPasskeySignup({ email, name: "Squatter" });
  const { response, credential } = register(options, { userVerified: true });
  const created = await finishPasskeySignup(response);
  return { userId: created.user.userId, session: created.session, credential };
}

/** Signs in with a passkey the software authenticator holds. */
async function signInWithPasskey(
  credential: SoftCredential,
  behaviour: { userVerified: boolean } = { userVerified: true },
) {
  const options = await startPasskeyAuthentication();
  return finishPasskeyAuthentication(
    assert(credential, options.challenge, behaviour),
  );
}

/** Everything a squatter signed in to the account can leave behind. */
async function plantCredentials(userId: string) {
  await linkAppleIdentity(userId, {
    subject: `apple-${randomUUID()}`,
    email: null,
    isPrivateEmail: true,
  });
  const key = await createApiToken(userId, {
    name: "Left behind",
    scope: "write",
  });
  const session = await createSession(userId);
  return { apiKey: key.token, session: session.token };
}

/** A credential as the ceremony would have reduced one, for rows only. */
function storedPasskey(): VerifiedRegistration {
  return {
    credentialId: `stored-${randomUUID()}`,
    publicKey: "cHVibGljLWtleQ",
    counter: 0,
    deviceType: "multiDevice",
    backedUp: true,
    transports: "internal",
    aaguid: null,
  };
}

async function credentialRows(userId: string) {
  const db = getDb();
  return {
    passkeys: await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, userId)),
    appleLinks: await db
      .select({ id: oauthIdentities.id })
      .from(oauthIdentities)
      .where(eq(oauthIdentities.userId, userId)),
  };
}

describe("recovering an address somebody else signed up with a passkey", () => {
  it("a password reset removes their passkey, Apple link, API keys and sessions", async () => {
    const email = uniqueEmail("squatted");
    const squat = await passkeySignup(email);
    const planted = await plantCredentials(squat.userId);

    await requestPasswordReset(email);
    expect(await resetPassword(lastLinkTo(email), "the-owners-own-42")).toBe(
      true,
    );

    expect(await credentialRows(squat.userId)).toEqual({
      passkeys: [],
      appleLinks: [],
    });
    expect(await resolveApiToken(planted.apiKey)).toBeNull();
    expect(await resolveSession(planted.session)).toBeNull();
    expect(await resolveSession(squat.session.token)).toBeNull();
    // The passkey the squatter still holds opens nothing any more.
    await expect(signInWithPasskey(squat.credential)).rejects.toMatchObject({
      code: "passkeyUnknown",
    });

    // And the owner is in: the reset proved the address, which is what lets
    // the password just chosen be used where mail is on.
    const owner = await signInWithPassword({
      email,
      password: "the-owners-own-42",
    });
    expect(owner.user.userId).toBe(squat.userId);
    expect(owner.user.emailVerified).toBe(true);
  });

  it("a sign-in code does the same, and keeps the session it hands out", async () => {
    const email = uniqueEmail("squatted");
    const squat = await passkeySignup(email);
    const planted = await plantCredentials(squat.userId);

    await requestSignInCode(email);
    const owner = await signInWithCode({ email, code: lastCodeTo(email) });

    expect(await credentialRows(squat.userId)).toEqual({
      passkeys: [],
      appleLinks: [],
    });
    expect(await resolveApiToken(planted.apiKey)).toBeNull();
    expect(await resolveSession(planted.session)).toBeNull();
    expect(await resolveSession(squat.session.token)).toBeNull();
    await expect(signInWithPasskey(squat.credential)).rejects.toMatchObject({
      code: "passkeyUnknown",
    });

    expect(owner.user.emailVerified).toBe(true);
    expect(await resolveSession(owner.session.token)).not.toBeNull();
  });

  it("stops an email change the squatter asked for before the owner arrived", async () => {
    // The link would otherwise move the account's recovery address to the
    // squatter's inbox after the owner had taken it back.
    const email = uniqueEmail("squatted");
    const squat = await passkeySignup(email);
    const theirs = uniqueEmail("squatters-inbox");
    await requestEmailChange(squat.userId, theirs);
    const pending = lastLinkTo(theirs);

    await requestSignInCode(email);
    await signInWithCode({ email, code: lastCodeTo(email) });

    expect(await confirmEmailChange(pending)).toBe("invalid");
  });

  it("does not let a password somebody registered with outlive a code", async () => {
    // The same squat, made with a password: unusable while the address is
    // unproved, and usable by its author the moment somebody else proves it.
    const email = uniqueEmail("squatted");
    await registerUser({ email, name: "Squatter", password: PASSWORD });

    await requestSignInCode(email);
    await signInWithCode({ email, code: lastCodeTo(email) });

    await expect(
      signInWithPassword({ email, password: PASSWORD }),
    ).rejects.toMatchObject({ code: "invalidCredentials" });
  });

  it("clears what got in ahead of the confirmation link, and keeps its password", async () => {
    const email = uniqueEmail("unconfirmed");
    const registered = await registerUser({
      email,
      name: "Registrant",
      password: PASSWORD,
    });
    const planted = await plantCredentials(registered.user.userId);

    expect(await verifyEmail(lastLinkTo(email))).toEqual({
      userId: registered.user.userId,
    });

    expect((await credentialRows(registered.user.userId)).appleLinks).toEqual(
      [],
    );
    expect(await resolveApiToken(planted.apiKey)).toBeNull();
    expect(await resolveSession(planted.session)).toBeNull();
    // The link went to whoever chose this password.
    const signedIn = await signInWithPassword({ email, password: PASSWORD });
    expect(signedIn.user.userId).toBe(registered.user.userId);
  });

  it("takes nothing from an address that was already proved", async () => {
    const email = uniqueEmail("proved");
    const owner = await passkeySignup(email);
    await requestSignInCode(email);
    await signInWithCode({ email, code: lastCodeTo(email) });

    // The owner adds a passkey after proving the address; a later code is
    // just a way in, not a line drawn under the account.
    await insertPasskey(owner.userId, storedPasskey(), undefined, {
      userHandle: "owners-handle",
    });
    const later = await createSession(owner.userId);

    await requestSignInCode(email);
    await signInWithCode({ email, code: lastCodeTo(email) });

    expect((await credentialRows(owner.userId)).passkeys).toHaveLength(1);
    expect(await resolveSession(later.token)).not.toBeNull();
  });
});

describe("a password reset on an address that was already proved", () => {
  async function provedAccount() {
    const email = uniqueEmail("owner");
    const [row] = await getDb()
      .insert(users)
      .values({
        email,
        name: "Owner",
        passwordHash: await hashPassword(PASSWORD),
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id, handle: users.webauthnUserHandle });
    await insertPasskey(row!.id, storedPasskey(), undefined, {
      userHandle: row!.handle,
    });
    return { userId: row!.id, email };
  }

  it("keeps the owner's passkeys and Apple link", async () => {
    const account = await provedAccount();
    await linkAppleIdentity(account.userId, {
      subject: `apple-${randomUUID()}`,
      email: null,
      isPrivateEmail: true,
    });

    await requestPasswordReset(account.email);
    await resetPassword(lastLinkTo(account.email), "a-brand-new-password");

    const rows = await credentialRows(account.userId);
    expect(rows.passkeys).toHaveLength(1);
    expect(rows.appleLinks).toHaveLength(1);
  });

  it("revokes every API key, which a borrowed session could have minted", async () => {
    const account = await provedAccount();
    const first = await createApiToken(account.userId, {
      name: "Wall tablet",
      scope: "read",
    });
    const second = await createApiToken(account.userId, {
      name: "Minted by whoever had the session",
      scope: "write",
    });

    await requestPasswordReset(account.email);
    await resetPassword(lastLinkTo(account.email), "a-brand-new-password");

    expect(await resolveApiToken(first.token)).toBeNull();
    expect(await resolveApiToken(second.token)).toBeNull();
  });

  it("stops an email change that was asked for and not yet confirmed", async () => {
    // The notice mailed to the old address tells the owner to reset their
    // password if the change was not theirs. That advice only works if the
    // reset is what stops it.
    const account = await provedAccount();
    const theirs = uniqueEmail("borrowers-inbox");
    await requestEmailChange(account.userId, theirs);
    const pending = lastLinkTo(theirs);

    await requestPasswordReset(account.email);
    await resetPassword(lastLinkTo(account.email), "a-brand-new-password");

    expect(await confirmEmailChange(pending)).toBe("invalid");
    const [row] = await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, account.userId));
    expect(row!.email).toBe(account.email);
  });
});

describe("confirming an email change", () => {
  it("revokes every API key the account held", async () => {
    const [row] = await getDb()
      .insert(users)
      .values({
        email: uniqueEmail("moving"),
        name: "Mover",
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });
    const key = await createApiToken(row!.id, {
      name: "Weekly export",
      scope: "read",
    });
    const target = uniqueEmail("moved");

    await requestEmailChange(row!.id, target);
    expect(await confirmEmailChange(lastLinkTo(target))).toBe("changed");

    expect(await resolveApiToken(key.token)).toBeNull();
  });
});

describe("user verification on a passkey", () => {
  it("is asked for when the passkey will be the whole account", async () => {
    const options = await startPasskeySignup({
      email: uniqueEmail("asked"),
      name: "Ada",
    });

    expect(options.authenticatorSelection?.userVerification).toBe("required");
  });

  it("is required of the passkey that creates an account", async () => {
    const email = uniqueEmail("touch-only");
    const options = await startPasskeySignup({ email, name: "Ada" });
    const { response } = register(options, { userVerified: false });

    await expect(finishPasskeySignup(response)).rejects.toMatchObject({
      code: "passkeyUserVerificationRequired",
    });
    const rows = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    expect(rows).toEqual([]);
  });

  it("is required to sign in to an account with no password", async () => {
    const account = await passkeySignup(uniqueEmail("passkey-only"));

    await expect(
      signInWithPasskey(account.credential, { userVerified: false }),
    ).rejects.toMatchObject({ code: "passkeyUserVerificationRequired" });

    const signedIn = await signInWithPasskey(account.credential, {
      userVerified: true,
    });
    expect(signedIn.userId).toBe(account.userId);
  });

  it("is not required where a password also guards the account", async () => {
    // A security key with no PIN set is a fine second way in beside a
    // password, and refusing it would refuse it for everybody.
    const account = await passkeySignup(uniqueEmail("with-password"));
    await getDb()
      .update(users)
      .set({ passwordHash: await hashPassword(PASSWORD) })
      .where(eq(users.id, account.userId));

    const signedIn = await signInWithPasskey(account.credential, {
      userVerified: false,
    });
    expect(signedIn.userId).toBe(account.userId);
  });
});
