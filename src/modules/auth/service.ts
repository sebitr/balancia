import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { users, verificationTokens } from "@/lib/db/schema";
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

export class AuthError extends Error {
  constructor(message: string) {
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
  context: { userAgent?: string | null; ipAddress?: string | null } = {},
  options: { db?: Database } = {},
): Promise<RegisterResult> {
  const env = getEnv();
  if (!env.ALLOW_REGISTRATION) {
    throw new AuthError("Registration is closed on this instance.");
  }

  const db = options.db ?? getDb();
  const email = normalizeEmail(input.email);
  const name = input.name.trim();

  if (name.length === 0) {
    throw new AuthError("Enter your name.");
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
    await sendVerificationEmail(userId, email, { db });
    return { user, session: null, verificationRequired: true };
  }

  // No mail server: the account is usable immediately, which is the only
  // sensible behaviour for a base installation.
  const session = await createSession(userId, context, { db });
  return { user, session, verificationRequired: false };
}

export interface SignInResult {
  readonly user: AuthenticatedUser;
  readonly session: CreatedSession;
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
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);

  // Always run a verification, even with no account, so the response time does
  // not reveal whether the address is registered.
  const hashToCheck = row?.passwordHash ?? (await getDummyHash());
  const passwordMatches = await verifyPassword(input.password, hashToCheck);

  if (!row || !row.passwordHash || !passwordMatches || row.disabledAt) {
    throw new AuthError(INVALID_CREDENTIALS);
  }

  if (env.smtpEnabled && row.emailVerifiedAt === null) {
    throw new AuthError(
      "Confirm your email address before signing in. Check your inbox for the link.",
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
  };
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
  options: { db?: Database } = {},
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
    subject: "Confirm your Balancia email address",
    text:
      `Welcome to Balancia.\n\n` +
      `Confirm this address to finish setting up your account:\n` +
      `${env.appOrigin}/verify-email?token=${token}\n\n` +
      `The link works for 24 hours.`,
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
    );
  }

  const db = options.db ?? getDb();
  const normalized = normalizeEmail(email);

  const [row] = await db
    .select({ id: users.id, email: users.email })
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
    subject: "Reset your Balancia password",
    text:
      `Someone asked to reset the password for your Balancia account.\n\n` +
      `Use this link within the next hour:\n` +
      `${env.appOrigin}/reset-password?token=${token}\n\n` +
      `If it wasn't you, you can ignore this message — nothing has changed.`,
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
    throw new AuthError("This account does not have a password set.");
  }
  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    throw new AuthError("Your current password is not correct.");
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
