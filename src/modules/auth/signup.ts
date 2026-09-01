import "server-only";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getDb, rowsAffected, type Database } from "@/lib/db/client";
import {
  groupMembers,
  oauthIdentities,
  participants,
  passkeys,
  sessions,
  users,
} from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  AuthError,
  insertUser,
  normalizeEmail,
  type AuthenticatedUser,
  type StoredPreferences,
} from "./service";
import { createSession, type CreatedSession } from "./sessions";
import { sendMail } from "./mailer";
import {
  renderSignInCodeEmail,
  renderVerifyCodeEmail,
} from "./emails/templates";
import { issueCode, consumeCode } from "./verification-codes";
import {
  insertPasskey,
  startSignupPasskeyRegistration,
  verifySignupPasskeyRegistration,
} from "./webauthn";

/**
 * Creating an account without inventing a password.
 *
 * Two ways in, and the difference between them is which thing the person is
 * proving they hold:
 *
 *  - **A passkey.** The credential is the account, so nothing is mailed and
 *    nothing is waited for. The account row and its first passkey are written
 *    in one transaction, *after* the authenticator has answered — an abandoned
 *    ceremony therefore leaves nothing behind at all, which is why the pending
 *    identity waits on the challenge row rather than in a half-made user.
 *
 *  - **A six-digit code.** The account row is written first, because the code
 *    has to be mailed to the address on it, and the session is issued only
 *    once the code comes back. That address is then verified by construction:
 *    the code arrived in the inbox, which is more than the confirmation link
 *    ever proved before somebody clicked it.
 *
 * An account made either way has no password, which is allowed — `users`
 * has said `passwordHash` may be null since passkeys were added. What that
 * makes newly possible is an account with a *code* and no other credential,
 * and the thing such an account must never be is stranded on the next device.
 * `requestSignInCode` is what keeps that promise; it is not an extra door so
 * much as the same one, since password reset has always turned access to the
 * inbox into access to the account.
 */

export interface SignupIdentity {
  readonly email: string;
  readonly name: string;
}

export interface SignupResult {
  readonly user: AuthenticatedUser;
  readonly session: CreatedSession;
  /**
   * What this account chose to read in, on the paths where there is something
   * to have chosen. Null for a signup, whose account is seconds old and has
   * chosen nothing yet — the browser it was made in is already right.
   */
  readonly preferences: StoredPreferences | null;
}

interface RequestContext {
  readonly userAgent?: string | null;
  readonly ipAddress?: string | null;
  /** Language the person was reading when they signed up. */
  readonly locale?: string | null;
}

/** The same gate `registerUser` keeps, applied to the two new front doors. */
function assertRegistrationOpen(): void {
  if (!getEnv().ALLOW_REGISTRATION) {
    throw new AuthError(
      "Registration is closed on this instance.",
      "registrationClosed",
    );
  }
}

function readIdentity(input: SignupIdentity): SignupIdentity {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new AuthError("Enter your name.", "nameRequired");
  }
  return { email: normalizeEmail(input.email), name: name.slice(0, 120) };
}

/**
 * A code is only worth mailing if there is a mail server to mail it with.
 *
 * On an instance without SMTP the whole code path is unreachable, and the
 * screens ask for a passkey or a password instead — so this is a guard against
 * a caller that got there anyway, not a case the reader is expected to meet.
 */
function assertMailable(): void {
  if (!getEnv().smtpEnabled) {
    throw new AuthError(
      "This instance cannot send email. Use a passkey or a password.",
      "mailNotConfigured",
    );
  }
}

/** Step one of a passkey signup: options for an account that does not exist. */
export async function startPasskeySignup(
  input: SignupIdentity,
  options: { db?: Database } = {},
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  assertRegistrationOpen();
  const identity = readIdentity(input);
  const db = options.db ?? getDb();

  /*
   * A pre-flight check on the address, which the unique index will make again
   * for real at the end.
   *
   * It is here to spend the reader's time well rather than to decide anything:
   * asking somebody to authorise a passkey and only then telling them the
   * address is taken wastes a biometric prompt on a dead end. The check
   * cannot be trusted — two ceremonies can pass it at once — and it does not
   * have to be, because the INSERT is still the authority.
   */
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, identity.email))
    .limit(1);
  if (existing) {
    throw new AuthError(
      "That email address is already registered. Try signing in instead.",
      "emailTaken",
    );
  }

  return startSignupPasskeyRegistration(identity, { db });
}

/**
 * Step two: the authenticator has answered, so the account can exist.
 *
 * The user row and the credential are one transaction. Either both land or
 * neither does, because an account whose only credential failed to save is one
 * nobody — including its owner — can ever sign in to.
 */
export async function finishPasskeySignup(
  response: RegistrationResponseJSON,
  context: RequestContext = {},
  options: { db?: Database } = {},
): Promise<SignupResult> {
  assertRegistrationOpen();
  const db = options.db ?? getDb();

  const { identity, credential } = await verifySignupPasskeyRegistration(
    response,
    { db },
  );

  const userId = await db.transaction(async (tx) => {
    const created = await insertUser(
      { email: identity.email, name: identity.name, passwordHash: null },
      { db: tx },
    );
    await insertPasskey(created, credential, undefined, { db: tx });
    return created;
  });

  const session = await createSession(userId, context, { db });
  return {
    user: {
      userId,
      email: identity.email,
      name: identity.name,
      /*
       * The address has not been confirmed and does not gate anything here.
       *
       * The confirmation link exists because a password account's address is
       * its recovery route, so an unconfirmed one is a way in for whoever ends
       * up owning it. A passkey account's way in is the authenticator, which
       * this person has just proved they hold. Asking them to go and find an
       * email before they may see their own balance would buy nothing — so the
       * address is collected, left unverified, and asked for again from the
       * checklist, where it costs nobody their arrival.
       */
      emailVerified: false,
    },
    session,
    preferences: null,
  };
}

/**
 * Creates the account and mails it a code. No session yet.
 *
 * The row is written before the address is proved, exactly as registering with
 * a password has always done — which is what makes an unconfirmed address able
 * to hold a name, and why the code that follows is worth asking for.
 */
export async function startCodeSignup(
  input: SignupIdentity,
  context: RequestContext = {},
  options: { db?: Database } = {},
): Promise<{ userId: string; email: string }> {
  assertRegistrationOpen();
  assertMailable();
  const identity = readIdentity(input);
  const db = options.db ?? getDb();

  const userId = await insertUser(
    { email: identity.email, name: identity.name, passwordHash: null },
    { db },
  );

  await mailCode(userId, identity.email, "email_verification_code", context, {
    db,
  });
  return { userId, email: identity.email };
}

/**
 * Spends the code, confirms the address and signs the new account in.
 *
 * Named by address rather than by id because the client between the two halves
 * of this is a form, not a session — and the address is the only handle it was
 * ever given.
 */
export async function verifySignupCode(
  input: { email: string; code: string },
  context: RequestContext = {},
  options: { db?: Database } = {},
): Promise<SignupResult> {
  const db = options.db ?? getDb();
  const email = normalizeEmail(input.email);

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);

  if (
    !row ||
    row.disabledAt ||
    !(await consumeCode(row.id, "email_verification_code", input.code, { db }))
  ) {
    // One message for a wrong code, an expired code and an address with no
    // account behind it. Telling them apart is a way to ask which addresses
    // are registered, one guess at a time.
    throw new AuthError(
      "That code is wrong or has expired. Ask for a new one.",
      "invalidCode",
    );
  }

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, row.id));

  const session = await createSession(row.id, context, { db });
  return {
    user: {
      userId: row.id,
      email: row.email,
      name: row.name,
      emailVerified: true,
    },
    session,
    preferences: null,
  };
}

/**
 * Mails a sign-in code, if there is an account to mail one to.
 *
 * Resolves the same way whether or not the address is registered — the same
 * rule `requestPasswordReset` follows, and for the same reason: an endpoint
 * that answers differently is an endpoint that lists a deployment's users.
 */
export async function requestSignInCode(
  email: string,
  context: RequestContext = {},
  options: { db?: Database } = {},
): Promise<void> {
  assertMailable();
  const db = options.db ?? getDb();
  const normalized = normalizeEmail(email);

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      locale: users.locale,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalized))
    .limit(1);

  if (!row || row.disabledAt) return;

  await mailCode(
    row.id,
    row.email,
    "sign_in_code",
    { ...context, locale: row.locale ?? context.locale },
    { db },
  );
}

/**
 * Signs in with a mailed code.
 *
 * Holding the inbox is the proof, so the address ends up verified here even if
 * it never was: a code that arrived cannot have arrived anywhere else.
 */
export async function signInWithCode(
  input: { email: string; code: string },
  context: RequestContext = {},
  options: { db?: Database } = {},
): Promise<SignupResult> {
  const db = options.db ?? getDb();
  const email = normalizeEmail(input.email);

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
      disabledAt: users.disabledAt,
      locale: users.locale,
      dateFormat: users.dateFormat,
      numberFormat: users.numberFormat,
      accentColor: users.accentColor,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);

  if (
    !row ||
    row.disabledAt ||
    !(await consumeCode(row.id, "sign_in_code", input.code, { db }))
  ) {
    throw new AuthError(
      "That code is wrong or has expired. Ask for a new one.",
      "invalidCode",
    );
  }

  if (row.emailVerifiedAt === null) {
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, row.id));
  }

  const session = await createSession(row.id, context, { db });
  return {
    user: {
      userId: row.id,
      email: row.email,
      name: row.name,
      emailVerified: true,
    },
    session,
    preferences: {
      locale: row.locale,
      dateFormat: row.dateFormat,
      numberFormat: row.numberFormat,
      accentColor: row.accentColor,
    },
  };
}

/** Issues a code and puts it in the post. */
async function mailCode(
  userId: string,
  email: string,
  purpose: "email_verification_code" | "sign_in_code",
  context: RequestContext,
  options: { db?: Database } = {},
): Promise<void> {
  const env = getEnv();
  const code = await issueCode(userId, purpose, options);
  const render =
    purpose === "sign_in_code" ? renderSignInCodeEmail : renderVerifyCodeEmail;

  try {
    await sendMail({
      to: email,
      ...render({ locale: context.locale, origin: env.appOrigin, code }),
    });
  } catch (error) {
    // The code is already stored, so a failed send leaves a live token nobody
    // has. Saying so is better than reporting success to a screen that will
    // then wait for a mail that is not coming.
    logger.error(
      { err: error instanceof Error ? error.message : String(error), purpose },
      "Could not send a sign-in code",
    );
    throw new AuthError(
      "The code could not be sent. Try again in a moment.",
      "codeSendFailed",
    );
  }
}

/**
 * How long an unproved address is held for the person who typed it. A
 * confirmation mail that arrives in seconds and is read after supper still has
 * the whole night.
 */
const UNCLAIMED_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * And how far back this is willing to look at all.
 *
 * Nothing older than a week is ever touched, which is the guard against the
 * one configuration change that would otherwise be catastrophic: an instance
 * that ran without SMTP for a year — where *every* account is unverified by
 * construction — and then switches it on. Sessions last thirty days and are
 * themselves pruned, so "has no session" cannot be trusted to mean "never
 * arrived" on an old row. Recency can.
 */
const UNCLAIMED_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deletes accounts that were begun and never proved.
 *
 * Registering writes the user row before the address is confirmed — with a
 * password, and with a mailed code — which is what lets somebody type an
 * address they do not own and keep it. The row is unreachable by whoever made
 * it, because an unverified account cannot sign in where SMTP is configured,
 * and it is unusable by the person the address belongs to, because
 * `insertUser` will answer them `emailTaken` for as long as it exists. That is
 * a denial of registration with no expiry, and one HTTP request to arrange.
 *
 * The passkey signup never had this problem — its identity waits on the
 * challenge row and no user exists until an authenticator has answered — so
 * this is the other two paths catching up, from the other end.
 *
 * Everything here is a guard against deleting somebody real:
 *
 *  - **No SMTP, no sweep.** Without a mail server nothing is ever verified and
 *    every account on the instance looks exactly like an abandoned one. This
 *    is the check that must never be removed.
 *  - **Nothing attached.** No session ever created, no passkey, no linked
 *    Apple identity, no group membership, no participant row claimed. An
 *    account with any of those got in, and getting in is proof enough.
 *  - **Not the administrator**, who on a self-hosted instance is whoever
 *    registered first.
 *  - **Recent, but not brand new** — see the two constants above.
 */
export async function pruneUnclaimedAccounts(
  now: Date = new Date(),
  options: { db?: Database } = {},
): Promise<number> {
  if (!getEnv().smtpEnabled) return 0;
  const db = options.db ?? getDb();

  const result = await db
    .delete(users)
    .where(
      and(
        isNull(users.emailVerifiedAt),
        eq(users.isAdmin, false),
        lt(users.createdAt, new Date(now.getTime() - UNCLAIMED_GRACE_MS)),
        gt(users.createdAt, new Date(now.getTime() - UNCLAIMED_HORIZON_MS)),
        sql`NOT EXISTS (SELECT 1 FROM ${sessions} WHERE ${sessions.userId} = ${users.id})`,
        sql`NOT EXISTS (SELECT 1 FROM ${passkeys} WHERE ${passkeys.userId} = ${users.id})`,
        sql`NOT EXISTS (SELECT 1 FROM ${oauthIdentities} WHERE ${oauthIdentities.userId} = ${users.id})`,
        sql`NOT EXISTS (SELECT 1 FROM ${groupMembers} WHERE ${groupMembers.userId} = ${users.id})`,
        sql`NOT EXISTS (SELECT 1 FROM ${participants} WHERE ${participants.userId} = ${users.id})`,
      ),
    );

  return rowsAffected(result);
}
