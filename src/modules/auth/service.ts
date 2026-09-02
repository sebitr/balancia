import "server-only";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  groupMembers,
  groups,
  oauthIdentities,
  participants,
  passkeys,
  sessions,
  users,
  verificationTokens,
} from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import {
  generateToken,
  hashToken,
  isWellFormedToken,
} from "@/lib/security/tokens";
import {
  assertPasswordPolicy,
  getDummyHash,
  hashPassword,
  verifyPassword,
} from "./passwords";
import {
  createSession,
  revokeAllSessionsForUser,
  type CreatedSession,
} from "./sessions";
import { sendMail } from "./mailer";
import {
  renderEmailChangeEmail,
  renderEmailChangeNoticeEmail,
  renderPasswordResetEmail,
  renderVerifyEmail,
} from "./emails/templates";
import { sanitiseFavoriteCurrencies } from "@/modules/currencies/favorites";

/**
 * Authentication service.
 *
 * Balancia implements this itself rather than delegating to an auth framework.
 * The rules it follows are the boring, important ones:
 *
 *  - Passwords are scrypt-hashed (see passwords.ts); the plaintext is never
 *    stored, logged or returned.
 *  - Sign-in failures are indistinguishable from each other, and take the same
 *    time whether or not the account exists.
 *  - Email verification, password reset and email change use single-use hashed
 *    tokens with a short lifetime, and a reset ends every existing session.
 *  - Without SMTP the instance still works; the flows that need email are
 *    simply not offered.
 */

/**
 * Reasons authentication can refuse, as stable codes.
 *
 * The message stays English and developer-facing; `code` is what the action
 * funnel translates before the text reaches a browser.
 */
export type AuthErrorCode =
  | "registrationClosed"
  | "nameRequired"
  | "emailTaken"
  | "emailUnverified"
  | "mailNotConfigured"
  | "noPassword"
  | "wrongPassword"
  | "invalidCredentials"
  | "invalidCode"
  | "codeSendFailed"
  | "resetLinkInvalid"
  | "confirmLinkInvalid"
  | "emailChangeLinkInvalid"
  | "emailUnchanged"
  | "signInRequired"
  | "appleNoEmail"
  | "appleEmailTaken"
  | "appleLinkedElsewhere"
  | "appleAlreadyLinked"
  | "appleOnlyCredential"
  | "appleNotLinked"
  | "passkeyChallengeExpired"
  | "passkeySignInExpired"
  | "passkeyUnverified"
  | "passkeyUnverifiedRepeatedly"
  | "passkeyAlreadyRegistered"
  | "passkeyUnknown"
  | "passkeyNotYours"
  | "passkeySignInAgain"
  | "malformedRequest";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code?: AuthErrorCode,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** One message for every credential failure, on purpose. */
const INVALID_CREDENTIALS = "Incorrect email or password.";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
/**
 * Shorter than a verification, longer than a reset. The person is at their
 * keyboard and has just asked for this, but the confirmation may have to
 * travel to an inbox they only read on another device.
 */
const EMAIL_CHANGE_TTL_MS = 2 * 60 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface RegisterInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface AuthenticatedUser {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly emailVerified: boolean;
}

export interface RegisterResult {
  readonly user: AuthenticatedUser;
  /** Absent when the instance requires email verification before sign-in. */
  readonly session: CreatedSession | null;
  readonly verificationRequired: boolean;
}

/**
 * Writes the account row, and nothing else.
 *
 * Separate from `registerUser` because a password is only one of three ways to
 * arrive at an account: a passkey signup writes a row with no password hash at
 * all, and a code signup writes one that is waiting for its address to be
 * confirmed. All three want the same INSERT, the same rule about who
 * administers the instance, and the same reading of a duplicate email.
 */
export async function insertUser(
  input: {
    readonly email: string;
    readonly name: string;
    /** Null for an account whose only credential is a passkey or a code. */
    readonly passwordHash: string | null;
  },
  options: { db?: Database } = {},
): Promise<string> {
  const db = options.db ?? getDb();
  try {
    const [created] = await db
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        /*
         * The first account on an instance is its administrator: on a
         * self-hosted deployment, whoever registers first is the person who
         * just ran `docker compose up`. Decided inside the INSERT so it cannot
         * be a read-then-write race against a second registration, and so
         * there is no separate "claim the instance" step to forget.
         *
         * It grants exactly one thing today — the telemetry settings — and
         * nothing about anybody's groups. See src/lib/security/admin.ts.
         */
        isAdmin: sql<boolean>`NOT EXISTS (SELECT 1 FROM ${users})`,
      })
      .returning({ id: users.id });
    return created.id;
  } catch (error) {
    // The unique index on lower(email) is the authority on duplicates — never
    // a pre-flight SELECT, which two concurrent registrations could both pass.
    if (isUniqueViolation(error)) {
      throw new AuthError(
        "That email address is already registered. Try signing in instead.",
        "emailTaken",
      );
    }
    throw error;
  }
}

/**
 * The clauses that say nothing ever got into an account.
 *
 * No session ever created, no passkey, no linked Apple identity, no group
 * membership, no participant row claimed. An account with any of those got
 * in, and getting in is proof enough. Shared by the sweep that deletes such
 * rows and by the signup that reclaims them, so the two cannot disagree about
 * what "unclaimed" means.
 */
export function neverGotIn() {
  return [
    sql`NOT EXISTS (SELECT 1 FROM ${sessions} WHERE ${sessions.userId} = ${users.id})`,
    sql`NOT EXISTS (SELECT 1 FROM ${passkeys} WHERE ${passkeys.userId} = ${users.id})`,
    sql`NOT EXISTS (SELECT 1 FROM ${oauthIdentities} WHERE ${oauthIdentities.userId} = ${users.id})`,
    sql`NOT EXISTS (SELECT 1 FROM ${groupMembers} WHERE ${groupMembers.userId} = ${users.id})`,
    sql`NOT EXISTS (SELECT 1 FROM ${participants} WHERE ${participants.userId} = ${users.id})`,
  ];
}

/**
 * Takes over an account begun at this address and never proved, if there is
 * one. Returns its id, or null when there is nothing to reclaim — in which
 * case the caller inserts, and the unique index decides.
 *
 * Both paths that mail an address write the user row before the mail goes
 * out, so "Send another code", "try again tomorrow" and a second attempt at
 * the password form all used to be answered with `emailTaken`: the wrong
 * sentence for the person who typed the address twice, and a door with no way
 * through for the one who closed the tab. The row is theirs to reclaim as long
 * as nothing has ever got into it, decided in the UPDATE's own predicate so
 * that two attempts cannot both win it.
 *
 * The name and the credential are replaced. Whoever made the first attempt may
 * not be the person about to prove the inbox, and a password they chose must
 * not outlive the proof that they never owned the address.
 */
export async function reclaimUnclaimedAccount(
  identity: { readonly email: string; readonly name: string },
  options: { db?: Database; passwordHash?: string | null } = {},
): Promise<string | null> {
  const db = options.db ?? getDb();
  const [reclaimed] = await db
    .update(users)
    .set({
      name: identity.name,
      passwordHash: options.passwordHash ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sql`lower(${users.email})`, normalizeEmail(identity.email)),
        isNull(users.emailVerifiedAt),
        ...neverGotIn(),
      ),
    )
    .returning({ id: users.id });
  return reclaimed?.id ?? null;
}

export async function registerUser(
  input: RegisterInput,
  context: {
    userAgent?: string | null;
    ipAddress?: string | null;
    /** Language the person was reading when they signed up. */
    locale?: string | null;
  } = {},
  options: { db?: Database } = {},
): Promise<RegisterResult> {
  const env = getEnv();
  if (!env.ALLOW_REGISTRATION) {
    throw new AuthError(
      "Registration is closed on this instance.",
      "registrationClosed",
    );
  }

  const db = options.db ?? getDb();
  const email = normalizeEmail(input.email);
  const name = input.name.trim();

  if (name.length === 0) {
    throw new AuthError("Enter your name.", "nameRequired");
  }
  assertPasswordPolicy(input.password, { email, name });

  const passwordHash = await hashPassword(input.password);
  const userId =
    (await reclaimUnclaimedAccount({ email, name }, { db, passwordHash })) ??
    (await insertUser({ email, name, passwordHash }, { db }));

  const user: AuthenticatedUser = {
    userId,
    email,
    name,
    emailVerified: false,
  };

  if (env.smtpEnabled) {
    await sendVerificationEmail(userId, email, { db, locale: context.locale });
    return { user, session: null, verificationRequired: true };
  }

  // No mail server: the account is usable immediately, which is the only
  // sensible behaviour for a base installation.
  const session = await createSession(userId, context, { db });
  return { user, session, verificationRequired: false };
}

/**
 * What an account chose to read in. Every field is null until it is chosen,
 * and sign-in seeds the matching cookies from these — which is how a returning
 * user gets their language and notation on a device that has no cookies yet.
 */
export interface StoredPreferences {
  readonly locale: string | null;
  readonly dateFormat: string | null;
  readonly numberFormat: string | null;
  readonly accentColor: string | null;
}

export interface SignInResult {
  readonly user: AuthenticatedUser;
  readonly session: CreatedSession;
  readonly preferences: StoredPreferences;
}

/** The columns behind `StoredPreferences`, for the selects that carry them. */
const PREFERENCE_COLUMNS = {
  locale: users.locale,
  dateFormat: users.dateFormat,
  numberFormat: users.numberFormat,
  accentColor: users.accentColor,
} as const;

function preferencesOf(row: StoredPreferences): StoredPreferences {
  return {
    locale: row.locale,
    dateFormat: row.dateFormat,
    numberFormat: row.numberFormat,
    accentColor: row.accentColor,
  };
}

export async function signInWithPassword(
  input: { email: string; password: string },
  context: { userAgent?: string | null; ipAddress?: string | null } = {},
  options: { db?: Database } = {},
): Promise<SignInResult> {
  const db = options.db ?? getDb();
  const env = getEnv();
  const email = normalizeEmail(input.email);

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      emailVerifiedAt: users.emailVerifiedAt,
      disabledAt: users.disabledAt,
      ...PREFERENCE_COLUMNS,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);

  // Always run a verification, even with no account, so the response time does
  // not reveal whether the address is registered.
  const hashToCheck = row?.passwordHash ?? (await getDummyHash());
  const passwordMatches = await verifyPassword(input.password, hashToCheck);

  if (!row || !row.passwordHash || !passwordMatches || row.disabledAt) {
    throw new AuthError(INVALID_CREDENTIALS, "invalidCredentials");
  }

  if (env.smtpEnabled && row.emailVerifiedAt === null) {
    throw new AuthError(
      "Confirm your email address before signing in. Check your inbox for the link.",
      "emailUnverified",
    );
  }

  const session = await createSession(row.id, context, { db });
  return {
    user: {
      userId: row.id,
      email: row.email,
      name: row.name,
      emailVerified: row.emailVerifiedAt !== null,
    },
    session,
    preferences: preferencesOf(row),
  };
}

/**
 * Signs in with a verified Apple identity, creating or linking as needed.
 *
 * The caller has already proved the claims came from Apple (see apple.ts);
 * what is decided here is which local account they belong to. Three cases, in
 * order:
 *
 *  1. This Apple account has been seen before — sign that user in. The `sub`
 *     is the only thing matched on, because it is the only claim Apple
 *     guarantees is stable. An address can change; a relay can be switched off.
 *
 *  2. It has not been seen, and the address matches an existing account.
 *     Linking the two would hand whoever holds the Apple account everything in
 *     the local one, so it happens only when both sides are verified — Apple
 *     says it verified the address, and this instance verified it too. Failing
 *     that, the person is asked to sign in the way they already can and link
 *     from the security page, which is the same outcome without trusting an
 *     unverified match. Note that an instance with no SMTP never verifies an
 *     address, so on one of those this branch always asks.
 *
 *  3. Neither — a new account, subject to ALLOW_REGISTRATION like any other.
 */
export async function signInWithApple(
  identity: {
    subject: string;
    email: string | null;
    emailVerified: boolean;
    isPrivateEmail: boolean;
  },
  context: {
    userAgent?: string | null;
    ipAddress?: string | null;
    /** Apple sends this only on the very first authorization. */
    fullName?: string | null;
  } = {},
  options: { db?: Database } = {},
): Promise<SignInResult> {
  const db = options.db ?? getDb();
  const env = getEnv();
  const now = new Date();
  const email = identity.email ? normalizeEmail(identity.email) : null;

  const [existing] = await db
    .select({
      userId: oauthIdentities.userId,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
      disabledAt: users.disabledAt,
      ...PREFERENCE_COLUMNS,
    })
    .from(oauthIdentities)
    .innerJoin(users, eq(users.id, oauthIdentities.userId))
    .where(
      and(
        eq(oauthIdentities.provider, "apple"),
        eq(oauthIdentities.subject, identity.subject),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.disabledAt) {
      throw new AuthError(INVALID_CREDENTIALS, "invalidCredentials");
    }

    // Keep the stored address current, so the security page names the Apple ID
    // that is actually linked rather than the one that was linked in 2024.
    await db
      .update(oauthIdentities)
      .set({
        lastUsedAt: now,
        email,
        isPrivateEmail: identity.isPrivateEmail,
      })
      .where(
        and(
          eq(oauthIdentities.provider, "apple"),
          eq(oauthIdentities.subject, identity.subject),
        ),
      );

    const session = await createSession(existing.userId, context, { db });
    return {
      user: {
        userId: existing.userId,
        email: existing.email,
        name: existing.name,
        emailVerified: existing.emailVerifiedAt !== null,
      },
      session,
      preferences: preferencesOf(existing),
    };
  }

  // Everything below creates or claims an account, and every route to that
  // needs an address.
  if (!email) {
    throw new AuthError(
      "Apple did not share an email address with this instance, so there is nothing to create an account from.",
      "appleNoEmail",
    );
  }

  const [claimed] = await db
    .select({
      id: users.id,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);

  if (claimed) {
    if (!identity.emailVerified || claimed.emailVerifiedAt === null) {
      throw new AuthError(
        "An account already uses that email address. Sign in with your password or passkey, " +
          "then link Apple from the security page.",
        "appleEmailTaken",
      );
    }

    await db.insert(oauthIdentities).values({
      userId: claimed.id,
      provider: "apple",
      subject: identity.subject,
      email,
      isPrivateEmail: identity.isPrivateEmail,
      lastUsedAt: now,
    });
    logger.info(
      { userId: claimed.id },
      "Linked an Apple identity to an existing account on both sides verified",
    );

    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerifiedAt: users.emailVerifiedAt,
        ...PREFERENCE_COLUMNS,
      })
      .from(users)
      .where(eq(users.id, claimed.id))
      .limit(1);

    const session = await createSession(claimed.id, context, { db });
    return {
      user: {
        userId: row.id,
        email: row.email,
        name: row.name,
        emailVerified: row.emailVerifiedAt !== null,
      },
      session,
      preferences: preferencesOf(row),
    };
  }

  if (!env.ALLOW_REGISTRATION) {
    throw new AuthError(
      "Registration is closed on this instance.",
      "registrationClosed",
    );
  }

  // Apple offers a name once, on the first authorization, and never again. If
  // it was not there, the local part of the address is a better placeholder
  // than an empty heading — and the person can change it in their profile.
  const name = context.fullName?.trim() || email.split("@")[0] || email;

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        name,
        // Apple verified the address; requiring this instance to verify it
        // again by mail would be asking a question that is already answered.
        // An unverified one (which Apple should not send) stays unverified.
        emailVerifiedAt: identity.emailVerified ? now : null,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerifiedAt: users.emailVerifiedAt,
        ...PREFERENCE_COLUMNS,
      });

    await tx.insert(oauthIdentities).values({
      userId: user.id,
      provider: "apple",
      subject: identity.subject,
      email,
      isPrivateEmail: identity.isPrivateEmail,
      lastUsedAt: now,
    });

    return user;
  });

  logger.info({ userId: created.id }, "Created an account from Apple sign-in");

  const session = await createSession(created.id, context, { db });
  return {
    user: {
      userId: created.id,
      email: created.email,
      name: created.name,
      emailVerified: created.emailVerifiedAt !== null,
    },
    session,
    preferences: preferencesOf(created),
  };
}

export interface LinkedAppleIdentity {
  readonly email: string | null;
  readonly isPrivateEmail: boolean;
  readonly linkedAt: Date;
  readonly lastUsedAt: Date | null;
}

/** The Apple account linked to this user, if any. */
export async function getLinkedAppleIdentity(
  userId: string,
  options: { db?: Database } = {},
): Promise<LinkedAppleIdentity | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({
      email: oauthIdentities.email,
      isPrivateEmail: oauthIdentities.isPrivateEmail,
      linkedAt: oauthIdentities.createdAt,
      lastUsedAt: oauthIdentities.lastUsedAt,
    })
    .from(oauthIdentities)
    .where(
      and(
        eq(oauthIdentities.userId, userId),
        eq(oauthIdentities.provider, "apple"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Links an Apple account to the signed-in user.
 *
 * This is the deliberate path that `signInWithApple` refuses to take on its
 * own: the person is already authenticated here, so no email match has to be
 * trusted. One Apple account per user and one user per Apple account — the
 * unique index enforces the second, and the check below reports it as
 * something a human can act on rather than a constraint violation.
 */
export async function linkAppleIdentity(
  userId: string,
  identity: {
    subject: string;
    email: string | null;
    isPrivateEmail: boolean;
  },
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();

  const [taken] = await db
    .select({ userId: oauthIdentities.userId })
    .from(oauthIdentities)
    .where(
      and(
        eq(oauthIdentities.provider, "apple"),
        eq(oauthIdentities.subject, identity.subject),
      ),
    )
    .limit(1);

  if (taken) {
    throw taken.userId === userId
      ? new AuthError(
          "That Apple account is already linked to this account.",
          "appleAlreadyLinked",
        )
      : new AuthError(
          "That Apple account is already linked to a different Balancia account.",
          "appleLinkedElsewhere",
        );
  }

  const existing = await getLinkedAppleIdentity(userId, { db });
  if (existing) {
    throw new AuthError(
      "This account already has an Apple account linked. Unlink it first.",
      "appleAlreadyLinked",
    );
  }

  try {
    await db.insert(oauthIdentities).values({
      userId,
      provider: "apple",
      subject: identity.subject,
      email: identity.email ? normalizeEmail(identity.email) : null,
      isPrivateEmail: identity.isPrivateEmail,
    });
  } catch (error) {
    // Two link attempts at once: the index is the authority, not the SELECT.
    if (isUniqueViolation(error)) {
      throw new AuthError(
        "That Apple account is already linked to a different Balancia account.",
        "appleLinkedElsewhere",
      );
    }
    throw error;
  }
  logger.info({ userId }, "Linked an Apple identity from the security page");
}

/**
 * Unlinks it, unless doing so would lock the person out.
 *
 * An account created through Apple has no password and may have no passkey, in
 * which case the Apple link is the only way back in. Removing it would leave
 * an account nobody can reach — and on an instance without SMTP there is not
 * even a password reset to recover with.
 */
export async function unlinkAppleIdentity(
  userId: string,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) {
    throw new AuthError("Sign in to change your account.", "signInRequired");
  }

  if (!row.passwordHash) {
    const [passkey] = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .limit(1);

    if (!passkey) {
      throw new AuthError(
        "Apple is the only way you can sign in to this account. Set a password or add a passkey first.",
        "appleOnlyCredential",
      );
    }
  }

  const removed = await db
    .delete(oauthIdentities)
    .where(
      and(
        eq(oauthIdentities.userId, userId),
        eq(oauthIdentities.provider, "apple"),
      ),
    )
    .returning({ id: oauthIdentities.id });

  if (removed.length === 0) {
    throw new AuthError(
      "There is no Apple account linked to this account.",
      "appleNotLinked",
    );
  }
  logger.info({ userId }, "Unlinked an Apple identity");
}

/**
 * Stores the account's preferred interface language.
 *
 * Written alongside the cookie whenever someone uses the language switcher, so
 * signing in elsewhere lands in the same language. The value is validated by
 * the caller against the supported locales.
 */
export async function saveUserLocale(
  userId: string,
  locale: string,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(users)
    .set({ locale, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Whether the account has a password at all.
 *
 * An account enrolled entirely through passkeys, or created with Apple, has
 * none — `password_hash` is null — and `changePassword` refuses to invent one,
 * because it has nothing to check the request against. The security screen
 * needs to know which of the two states it is drawing: a password to change,
 * or a password to set for the first time, which goes the long way round
 * through a link sent to the address on the account.
 */
export async function hasPassword(
  userId: string,
  options: { db?: Database } = {},
): Promise<boolean> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Boolean(row?.passwordHash);
}

/**
 * The name on the account.
 *
 * Not the name anybody sees inside a group: that is `participants.display_name`,
 * chosen per group so the same person can be "Seb" to their flatmates and
 * "Sébastien Trosset" to a work trip. This one is what the account itself is
 * called — what the settings hub greets, and what a new group starts a
 * participant off with.
 *
 * Trimmed and bounded by the caller; empty is refused there rather than
 * written as a blank name nothing can render.
 */
export async function saveUserName(
  userId: string,
  name: string,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(users)
    .set({ name, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * The currency the home screen totals every group into.
 *
 * Null means the account has never chosen one, which is not an error: the home
 * screen then totals in whichever currency that user's own groups balance in
 * most often.
 */
export async function getUserPreferredCurrency(
  userId: string,
  options: { db?: Database } = {},
): Promise<string | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({ preferredCurrency: users.preferredCurrency })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.preferredCurrency ?? null;
}

/**
 * The currencies this account has starred, in its own order.
 *
 * Sanitised on the way out as well as on the way in: a code can be withdrawn
 * from the supported list long after somebody starred it, and a picker that
 * pins a currency it can no longer offer is worse than one that quietly
 * forgets it.
 */
export async function getUserFavoriteCurrencies(
  userId: string,
  options: { db?: Database } = {},
): Promise<string[]> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({ favoriteCurrencies: users.favoriteCurrencies })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return sanitiseFavoriteCurrencies(row?.favoriteCurrencies ?? []);
}

/**
 * The four preferences an account carries between devices.
 *
 * Sign-in already reads these to seed the cookies; this is the same read for
 * callers who have a session rather than a sign-in — the mobile API, which
 * has no cookies to seed and asks for them outright.
 */
export async function getUserPreferences(
  userId: string,
  options: { db?: Database } = {},
): Promise<StoredPreferences> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select(PREFERENCE_COLUMNS)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row
    ? preferencesOf(row)
    : { locale: null, dateFormat: null, numberFormat: null, accentColor: null };
}

/** Replaces the whole list — the client owns the order, so it sends all of it. */
export async function saveUserFavoriteCurrencies(
  userId: string,
  favoriteCurrencies: readonly string[],
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(users)
    .set({
      favoriteCurrencies: sanitiseFavoriteCurrencies(favoriteCurrencies),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/** Stores it. `null` clears the choice and restores the derived default. */
export async function saveUserPreferredCurrency(
  userId: string,
  preferredCurrency: string | null,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(users)
    .set({ preferredCurrency, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * How the account writes dates and numbers.
 *
 * `null` on either is the same "not chosen yet" the language column uses, and
 * means the reader's own locale decides. Validation of the values themselves
 * belongs to the caller, and to the check constraints on the columns.
 */
export async function saveUserFormatPreferences(
  userId: string,
  preferences: { dateFormat: string | null; numberFormat: string | null },
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(users)
    .set({ ...preferences, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Which colour this account paints its accent.
 *
 * `null` is the same absence of a choice as the two above, and means the coral
 * the app has always used. Which names are allowed is the check constraint's
 * business and `modules/profile/accent.ts`'s; this only writes.
 */
export async function saveUserAccentColor(
  userId: string,
  accentColor: string | null,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(users)
    .set({ accentColor, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

type VerificationPurpose =
  "email_verification" | "password_reset" | "email_change";

async function issueVerificationToken(
  userId: string,
  purpose: VerificationPurpose,
  ttlMs: number,
  options: { db?: Database; newEmail?: string } = {},
): Promise<string> {
  const db = options.db ?? getDb();
  const token = generateToken();

  // Only one live token per purpose: issuing a new one invalidates the old.
  await db
    .update(verificationTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(verificationTokens.userId, userId),
        eq(verificationTokens.purpose, purpose),
        isNull(verificationTokens.consumedAt),
      ),
    );

  await db.insert(verificationTokens).values({
    userId,
    purpose,
    tokenHash: token.hash,
    newEmail: options.newEmail ?? null,
    expiresAt: new Date(Date.now() + ttlMs),
  });

  return token.raw;
}

interface ConsumedToken {
  readonly userId: string;
  /** Only ever set on an `email_change`. */
  readonly newEmail: string | null;
}

async function consumeVerificationToken(
  rawToken: string,
  purpose: VerificationPurpose,
  options: { db?: Database } = {},
): Promise<ConsumedToken | null> {
  if (!isWellFormedToken(rawToken)) return null;
  const db = options.db ?? getDb();

  // Consume and read in one statement so a token cannot be used twice by two
  // concurrent requests.
  const [row] = await db
    .update(verificationTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(verificationTokens.tokenHash, hashToken(rawToken)),
        eq(verificationTokens.purpose, purpose),
        isNull(verificationTokens.consumedAt),
        gt(verificationTokens.expiresAt, new Date()),
      ),
    )
    .returning({
      userId: verificationTokens.userId,
      newEmail: verificationTokens.newEmail,
    });

  return row ?? null;
}

export async function sendVerificationEmail(
  userId: string,
  email: string,
  options: { db?: Database; locale?: string | null } = {},
): Promise<void> {
  const env = getEnv();
  if (!env.smtpEnabled) return;

  const token = await issueVerificationToken(
    userId,
    "email_verification",
    EMAIL_VERIFICATION_TTL_MS,
    options,
  );

  await sendMail({
    to: email,
    ...renderVerifyEmail({
      locale: options.locale,
      origin: env.appOrigin,
      url: `${env.appOrigin}/verify-email?token=${token}`,
    }),
  });
}

export async function verifyEmail(
  rawToken: string,
  options: { db?: Database } = {},
): Promise<{ userId: string } | null> {
  const db = options.db ?? getDb();
  const consumed = await consumeVerificationToken(
    rawToken,
    "email_verification",
    { db },
  );
  if (!consumed) return null;

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, consumed.userId));
  // Whose address was just proved, so the link can sign them in: the token
  // was the whole of the proof, and asking for a password after it is
  // asking twice.
  return { userId: consumed.userId };
}

/**
 * Starts a password reset.
 *
 * Always resolves successfully, whether or not the address is registered —
 * otherwise this endpoint becomes a way to enumerate accounts.
 */
export async function requestPasswordReset(
  email: string,
  options: {
    db?: Database;
    /** Language the person was reading when they asked. */
    locale?: string | null;
  } = {},
): Promise<void> {
  const env = getEnv();
  if (!env.smtpEnabled) {
    throw new AuthError(
      "Password recovery needs email, which is not configured on this instance. Ask the administrator for help.",
      "mailNotConfigured",
    );
  }

  const db = options.db ?? getDb();
  const normalized = normalizeEmail(email);

  const [row] = await db
    .select({ id: users.id, email: users.email, locale: users.locale })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalized))
    .limit(1);

  if (!row) {
    logger.info(
      { reason: "unknown-address" },
      "Password reset requested for an address with no account",
    );
    return;
  }

  const token = await issueVerificationToken(
    row.id,
    "password_reset",
    PASSWORD_RESET_TTL_MS,
    { db },
  );

  await sendMail({
    to: row.email,
    ...renderPasswordResetEmail({
      // The account's own language, so a reset mail reads the same as the app —
      // falling back to the language the request was made in, which for an
      // account that has never touched the switcher is the only signal there is.
      locale: row.locale ?? options.locale,
      origin: env.appOrigin,
      url: `${env.appOrigin}/reset-password?token=${token}`,
    }),
  });
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
  options: { db?: Database } = {},
): Promise<boolean> {
  /*
   * Without the identity, deliberately.
   *
   * Who this token belongs to is not known until it has been spent, and
   * spending it to find out would mean a password refused for containing
   * somebody's own name also costs them their link. The length and
   * common-password rules are the ones an attacker cares about and they both
   * run here; the name check is a nudge at the point of choosing, and it is
   * not worth a dead token.
   */
  assertPasswordPolicy(newPassword);
  const db = options.db ?? getDb();

  const consumed = await consumeVerificationToken(rawToken, "password_reset", {
    db,
  });
  if (!consumed) return false;
  const { userId } = consumed;

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Anyone signed in with the old password loses their session.
  await revokeAllSessionsForUser(userId, { db });
  logger.info({ userId }, "Password reset completed");
  return true;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();

  const [row] = await db
    .select({
      passwordHash: users.passwordHash,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // After the read rather than before it: this is the one password path that
  // already knows whose account it is, so the full policy — the name check
  // included — costs nothing extra here.
  assertPasswordPolicy(newPassword, { email: row?.email, name: row?.name });

  if (!row?.passwordHash) {
    throw new AuthError(
      "This account does not have a password set.",
      "noPassword",
    );
  }
  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    throw new AuthError(
      "Your current password is not correct.",
      "wrongPassword",
    );
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Starts a change of the account's email address.
 *
 * Two messages go out, and both matter:
 *
 *  - to the *new* address, a link that is the only thing which can complete
 *    the change. Nothing moves until someone proves they read that inbox, so a
 *    typo costs a bounced mail rather than an account nobody can sign in to.
 *  - to the *old* address, a notice that the change was asked for. Sent at
 *    request time rather than on completion, because its whole purpose is to
 *    reach the account holder while there is still something to be done about
 *    it — the address it lands in is the one that still works.
 *
 * The notice is sent first for the same reason: if delivery fails, the request
 * fails, and the token that was issued a moment earlier is simply never mailed
 * to anyone. A change is never made quietly.
 *
 * An instance without SMTP cannot do either, so it does not offer the flow at
 * all — the same answer password recovery gives.
 */
export async function requestEmailChange(
  userId: string,
  newEmail: string,
  options: {
    db?: Database;
    /** Language the person was reading when they asked. */
    locale?: string | null;
  } = {},
): Promise<void> {
  const env = getEnv();
  if (!env.smtpEnabled) {
    throw new AuthError(
      "Changing your email address needs email, which is not configured on this instance. Ask the administrator for help.",
      "mailNotConfigured",
    );
  }

  const db = options.db ?? getDb();
  const email = normalizeEmail(newEmail);

  const [current] = await db
    .select({ email: users.email, name: users.name, locale: users.locale })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!current) {
    throw new AuthError("Sign in to change your account.", "signInRequired");
  }

  if (normalizeEmail(current.email) === email) {
    throw new AuthError(
      "That is already the address on this account.",
      "emailUnchanged",
    );
  }

  /*
   * Reported now rather than after a round trip through an inbox, where the
   * only honest thing left to say would be "that link did not work". It tells
   * a signed-in reader nothing that registration does not already tell an
   * anonymous one — see the `emailTaken` refusal in `registerUser`.
   */
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);
  if (taken) {
    throw new AuthError(
      "That email address is already registered. Try signing in instead.",
      "emailTaken",
    );
  }

  const token = await issueVerificationToken(
    userId,
    "email_change",
    EMAIL_CHANGE_TTL_MS,
    { db, newEmail: email },
  );

  // Both messages are for the same person, so both are written in the account's
  // language — or, failing a stored one, in the language they are reading now.
  const locale = current.locale ?? options.locale;
  await sendMail({
    to: current.email,
    ...renderEmailChangeNoticeEmail({
      locale,
      origin: env.appOrigin,
      newEmail: email,
      /*
       * Recovery, not a change-password screen: there is no such screen, and
       * this is the better answer anyway. The link mails *this* address — the
       * one the account still has, and the one whoever asked for the change
       * cannot read — and completing the reset ends every session, which puts
       * them out. A password form behind a session they may already hold would
       * not.
       */
      recoverUrl: `${env.appOrigin}/forgot-password`,
    }),
  });
  await sendMail({
    to: email,
    ...renderEmailChangeEmail({
      locale,
      origin: env.appOrigin,
      url: `${env.appOrigin}/confirm-email?token=${token}`,
    }),
  });

  logger.info({ userId }, "Email change requested");
}

export type EmailChangeOutcome = "changed" | "taken" | "invalid";

/**
 * Completes it.
 *
 * Reached from a link, so it cannot assume a session: the person may well be
 * reading their new inbox on a device this instance has never seen. The token
 * is the whole of the authorization, which is why it is single-use, expires in
 * hours, and carries the target address itself — the address is not something
 * the request gets to choose.
 *
 * The address arrives verified, because clicking the link is the proof that
 * `sendVerificationEmail` would otherwise ask for separately.
 */
export async function confirmEmailChange(
  rawToken: string,
  options: { db?: Database } = {},
): Promise<EmailChangeOutcome> {
  const db = options.db ?? getDb();

  const consumed = await consumeVerificationToken(rawToken, "email_change", {
    db,
  });
  if (!consumed?.newEmail) return "invalid";
  const { userId, newEmail } = consumed;

  try {
    await db
      .update(users)
      .set({
        email: newEmail,
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } catch (error) {
    // Somebody else registered the address while this link sat in an inbox.
    // The unique index is the authority; the check at request time was only
    // ever a courtesy.
    if (isUniqueViolation(error)) return "taken";
    throw error;
  }

  logger.info({ userId }, "Email change confirmed");
  return "changed";
}

/**
 * Closing an account for good.
 *
 * A real `DELETE`, not a flag. The schema was already built for it: everything
 * that *is* the account cascades away — sessions, passkeys, the Apple link,
 * pending tokens, push subscriptions, notifications and their preferences,
 * group membership — while everything that is *history* references a
 * `participant` rather than a user and is left standing. `participants.userId`
 * is `ON DELETE SET NULL`, and a participant carries its own `display_name`,
 * so every expense, split, settlement and receipt stays exactly where it was,
 * under the name it was recorded against. That is the promise the screen makes
 * and this is what keeps it.
 *
 * Deleting rather than disabling also releases the address. Somebody who
 * closes an account and thinks better of it a week later can sign up again;
 * a tombstone row holding `email` would have made that impossible, and the
 * account they lost is not one anybody can get back for them.
 *
 * Two things the cascades cannot decide on their own:
 *
 *  - **A group this account owned** would be left with no owner, which is not
 *    a crash but is a group nobody can rename, archive or manage. The
 *    longest-standing remaining member is promoted.
 *  - **A group with no other member at all** has just lost the only person who
 *    could open it. Its remaining participants are names on a list, not
 *    accounts, so there is no one to promote and no way back in. It goes with
 *    the account rather than becoming unreachable rows.
 *
 * The avatar object is swept afterwards, outside the transaction: a bucket
 * that keeps one orphan is a smaller problem than a deletion that fails
 * because a bucket was briefly unreachable.
 */
export async function deleteAccount(
  userId: string,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();

  const [account] = await db
    .select({ avatarKey: users.avatarStorageKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!account) return;

  await db.transaction(async (tx) => {
    // Every group this account belongs to, with the role it holds there.
    const memberships = await tx
      .select({ groupId: groupMembers.groupId, role: groupMembers.role })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId));

    for (const membership of memberships) {
      const survivors = await tx
        .select({ id: groupMembers.id, userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, membership.groupId),
            ne(groupMembers.userId, userId),
          ),
        )
        .orderBy(groupMembers.joinedAt);

      if (survivors.length === 0) {
        // Nobody left who could ever open it.
        await tx.delete(groups).where(eq(groups.id, membership.groupId));
        continue;
      }

      if (membership.role === "owner") {
        await tx
          .update(groupMembers)
          .set({ role: "owner" })
          .where(eq(groupMembers.id, survivors[0].id));
      }
    }

    // The cascades do the rest; `participants.userId` goes null and keeps its
    // display name, which is what every expense in every group is written
    // against.
    await tx.delete(users).where(eq(users.id, userId));
  });

  if (account.avatarKey) {
    try {
      await getStorage().delete(account.avatarKey);
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          userId,
        },
        "Avatar object outlived the account that owned it",
      );
    }
  }

  logger.info({ userId }, "Account deleted");
}
