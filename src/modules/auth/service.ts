import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import {
  oauthIdentities,
  passkeys,
  users,
  verificationTokens,
} from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
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
import { emailTranslator } from "@/i18n/emails";

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
 *  - Email verification and password reset use single-use hashed tokens with
 *    a short lifetime, and a reset ends every existing session.
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
  | "resetLinkInvalid"
  | "confirmLinkInvalid"
  | "signInRequired"
  | "appleNoEmail"
  | "appleEmailTaken"
  | "appleLinkedElsewhere"
  | "appleAlreadyLinked"
  | "appleOnlyCredential"
  | "appleNotLinked";

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
const INVALID_CREDENTIALS = "That email and password combination did not work.";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Detects PostgreSQL's unique_violation (SQLSTATE 23505).
 *
 * Drizzle wraps driver errors, so the code lives on `cause` rather than on the
 * error itself; matching on the message text would break the moment the
 * wrapper's wording changes.
 */
export function isUniqueViolation(error: unknown): boolean {
  const codeOf = (value: unknown): string | undefined =>
    typeof value === "object" && value !== null && "code" in value
      ? String((value as { code: unknown }).code)
      : undefined;

  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (codeOf(current) === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
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
  assertPasswordPolicy(input.password);

  const passwordHash = await hashPassword(input.password);

  let userId: string;
  try {
    const [created] = await db
      .insert(users)
      .values({ email, name, passwordHash })
      .returning({ id: users.id });
    userId = created.id;
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
} as const;

function preferencesOf(row: StoredPreferences): StoredPreferences {
  return {
    locale: row.locale,
    dateFormat: row.dateFormat,
    numberFormat: row.numberFormat,
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

async function issueVerificationToken(
  userId: string,
  purpose: "email_verification" | "password_reset",
  ttlMs: number,
  options: { db?: Database } = {},
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
    expiresAt: new Date(Date.now() + ttlMs),
  });

  return token.raw;
}

async function consumeVerificationToken(
  rawToken: string,
  purpose: "email_verification" | "password_reset",
  options: { db?: Database } = {},
): Promise<string | null> {
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
    .returning({ userId: verificationTokens.userId });

  return row?.userId ?? null;
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

  const t = emailTranslator(options.locale);
  await sendMail({
    to: email,
    subject: t("verifySubject"),
    text: t("verifyBody", {
      url: `${env.appOrigin}/verify-email?token=${token}`,
    }),
  });
}

export async function verifyEmail(
  rawToken: string,
  options: { db?: Database } = {},
): Promise<boolean> {
  const db = options.db ?? getDb();
  const userId = await consumeVerificationToken(
    rawToken,
    "email_verification",
    { db },
  );
  if (!userId) return false;

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
  return true;
}

/**
 * Starts a password reset.
 *
 * Always resolves successfully, whether or not the address is registered —
 * otherwise this endpoint becomes a way to enumerate accounts.
 */
export async function requestPasswordReset(
  email: string,
  options: { db?: Database } = {},
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

  // The account's own language, so a reset mail reads the same as the app.
  const t = emailTranslator(row.locale);
  await sendMail({
    to: row.email,
    subject: t("resetSubject"),
    text: t("resetBody", {
      url: `${env.appOrigin}/reset-password?token=${token}`,
    }),
  });
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
  options: { db?: Database } = {},
): Promise<boolean> {
  assertPasswordPolicy(newPassword);
  const db = options.db ?? getDb();

  const userId = await consumeVerificationToken(rawToken, "password_reset", {
    db,
  });
  if (!userId) return false;

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
  assertPasswordPolicy(newPassword);
  const db = options.db ?? getDb();

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

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

export async function getUserById(
  userId: string,
  options: { db?: Database } = {},
): Promise<AuthenticatedUser | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerifiedAt !== null,
  };
}
