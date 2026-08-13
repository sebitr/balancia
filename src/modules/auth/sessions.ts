import "server-only";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import {
  generateToken,
  hashToken,
  isWellFormedToken,
} from "@/lib/security/tokens";

/**
 * User sessions.
 *
 * The same design as guest sessions: a 256-bit opaque token in an HttpOnly
 * cookie, of which only the SHA-256 hash is stored. A database leak therefore
 * yields no usable sessions, and there is no signed-payload cookie whose
 * secret could be compromised to mint arbitrary sessions.
 */

export const SESSION_COOKIE_NAME = "balancia_session";

/** Sessions last 30 days from creation. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How stale `lastSeenAt` may get before it is written again. Updating on every
 * request would mean a write per page view for no benefit.
 */
const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;

export interface SessionUser {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly emailVerifiedAt: Date | null;
  readonly sessionId: string;
}

export interface CreatedSession {
  /** Raw token for the cookie. Never stored. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly sessionId: string;
}

export async function createSession(
  userId: string,
  context: { userAgent?: string | null; ipAddress?: string | null } = {},
  options: { db?: Database; now?: Date } = {},
): Promise<CreatedSession> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  const [created] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: token.hash,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
      userAgent: context.userAgent?.slice(0, 300) ?? null,
      ipAddress: context.ipAddress ?? null,
    })
    .returning({ id: sessions.id });

  return { token: token.raw, expiresAt, sessionId: created.id };
}

/** Resolves a session cookie into the signed-in user, or null. */
export async function resolveSession(
  rawToken: string | undefined,
  options: { db?: Database; now?: Date } = {},
): Promise<SessionUser | null> {
  if (!rawToken || !isWellFormedToken(rawToken)) {
    return null;
  }
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(rawToken)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row || row.disabledAt !== null) {
    return null;
  }

  // Refresh activity occasionally, never blocking the request on it.
  if (now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    void db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, row.sessionId))
      .catch(() => undefined);
  }

  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    emailVerifiedAt: row.emailVerifiedAt,
    sessionId: row.sessionId,
  };
}

export async function revokeSession(
  rawToken: string,
  options: { db?: Database } = {},
): Promise<void> {
  if (!isWellFormedToken(rawToken)) return;
  const db = options.db ?? getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(rawToken)));
}

/** Ends every session for a user — used after a password reset. */
export async function revokeAllSessionsForUser(
  userId: string,
  options: { db?: Database; exceptSessionId?: string } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return revoked.length;
}

/** Deletes expired sessions. Called by the maintenance job. */
export async function pruneSessions(
  now: Date = new Date(),
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const deleted = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return deleted.length;
}
