import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { groupJoinLinks, groups, users } from "@/lib/db/schema";
import { generateToken, hashToken, isWellFormedToken } from "./tokens";

/**
 * The group-wide join link.
 *
 * `guest-session.ts` next door exchanges its token for a *separate* session
 * token, because that link grants a participant identity and everything that
 * identity can see and do. This one grants far less — the onboarding screens,
 * and the group facts they show — so it is carried differently:
 *
 * The cookie holds the link token itself, and every read re-resolves it by
 * hash. There is no second table and no session row, and the consequence is
 * the useful one: revoking the link ends every in-flight join immediately,
 * because there is no derived credential to outlive it. The cookie is exactly
 * as powerful as the link, which is a property that is easy to reason about
 * and hard to get wrong.
 *
 * What the cookie buys over leaving the token in the URL is the same thing it
 * buys the guest flow: after the redemption redirect the token is not in the
 * address bar, not in history, and not in a referrer sent to a third party.
 *
 * The moment the flow finishes, the cookie is cleared. It is not a session.
 */

export const JOIN_COOKIE_NAME = "balancia_join";

/**
 * One hour. Long enough to read the screens, pick a name and think about it;
 * short enough that a borrowed phone does not stay half-joined all week.
 */
export const JOIN_COOKIE_TTL_MS = 60 * 60 * 1000;

export interface JoinLinkContext {
  readonly linkId: string;
  readonly groupId: string;
  readonly groupName: string;
  /** Who created the link. Null when that account is gone. */
  readonly inviterName: string | null;
}

export type JoinLinkFailure = "invalid" | "expired" | "revoked";

export class InvalidJoinLinkError extends Error {
  readonly reason: JoinLinkFailure;
  constructor(reason: JoinLinkFailure = "invalid") {
    super("This join link is not valid.");
    this.name = "InvalidJoinLinkError";
    this.reason = reason;
  }
}

/**
 * Resolves a raw link token into its group.
 *
 * Separates "never existed" from "existed and is over", because the screens
 * say different things for the two: a mistyped link is the reader's problem,
 * a revoked one is something to ask the group about.
 */
export async function resolveJoinLink(
  rawToken: string | undefined,
  options: { now?: Date; db?: Database } = {},
): Promise<JoinLinkContext> {
  if (!rawToken || !isWellFormedToken(rawToken)) {
    throw new InvalidJoinLinkError("invalid");
  }
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const [link] = await db
    .select({
      id: groupJoinLinks.id,
      groupId: groupJoinLinks.groupId,
      expiresAt: groupJoinLinks.expiresAt,
      revokedAt: groupJoinLinks.revokedAt,
      groupName: groups.name,
      groupArchivedAt: groups.archivedAt,
      inviterName: users.name,
    })
    .from(groupJoinLinks)
    .innerJoin(groups, eq(groups.id, groupJoinLinks.groupId))
    .leftJoin(users, eq(users.id, groupJoinLinks.createdByUserId))
    .where(eq(groupJoinLinks.tokenHash, hashToken(rawToken)))
    .limit(1);

  if (!link) throw new InvalidJoinLinkError("invalid");
  // An archived group is closed to newcomers, and saying so would leak that it
  // exists. It reads as a dead link, which is what it is.
  if (link.groupArchivedAt !== null) throw new InvalidJoinLinkError("revoked");
  if (link.revokedAt !== null) throw new InvalidJoinLinkError("revoked");
  if (link.expiresAt !== null && link.expiresAt <= now) {
    throw new InvalidJoinLinkError("expired");
  }

  return {
    linkId: link.id,
    groupId: link.groupId,
    groupName: link.groupName,
    inviterName: link.inviterName,
  };
}

/** Stamps the link as used. Best effort: never blocks the redirect. */
export async function touchJoinLink(
  linkId: string,
  options: { now?: Date; db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(groupJoinLinks)
    .set({ lastUsedAt: options.now ?? new Date() })
    .where(eq(groupJoinLinks.id, linkId));
}

/**
 * Mints the group's join link, revoking whatever it had.
 *
 * The raw token is returned once and never stored, so a link that is lost has
 * to be replaced rather than looked up. Replacing it is the recovery path for
 * a link that reached the wrong chat.
 */
export async function createJoinLink(
  groupId: string,
  options: {
    createdByUserId?: string | null;
    expiresAt?: Date | null;
    now?: Date;
    db?: Database;
  } = {},
): Promise<{ token: string; linkId: string; prefix: string }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const token = generateToken();

  return db.transaction(async (tx) => {
    // The partial unique index allows one live link per group, so the old one
    // has to go inside the same transaction that adds the new one.
    await tx
      .update(groupJoinLinks)
      .set({ revokedAt: now })
      .where(
        and(
          eq(groupJoinLinks.groupId, groupId),
          isNull(groupJoinLinks.revokedAt),
        ),
      );

    const [created] = await tx
      .insert(groupJoinLinks)
      .values({
        groupId,
        tokenHash: token.hash,
        tokenPrefix: token.prefix,
        createdByUserId: options.createdByUserId ?? null,
        expiresAt: options.expiresAt ?? null,
        createdAt: now,
      })
      .returning({ id: groupJoinLinks.id });

    return { token: token.raw, linkId: created.id, prefix: token.prefix };
  });
}

/** Ends the group's live link. Every cookie derived from it dies with it. */
export async function revokeJoinLink(
  groupId: string,
  options: { now?: Date; db?: Database } = {},
): Promise<boolean> {
  const db = options.db ?? getDb();
  const revoked = await db
    .update(groupJoinLinks)
    .set({ revokedAt: options.now ?? new Date() })
    .where(
      and(
        eq(groupJoinLinks.groupId, groupId),
        isNull(groupJoinLinks.revokedAt),
      ),
    )
    .returning({ id: groupJoinLinks.id });
  return revoked.length > 0;
}

/** The live link's prefix and age, for the screen that manages it. */
export async function describeJoinLink(
  groupId: string,
  options: { db?: Database } = {},
): Promise<{
  readonly prefix: string;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
} | null> {
  const db = options.db ?? getDb();
  const [link] = await db
    .select({
      prefix: groupJoinLinks.tokenPrefix,
      createdAt: groupJoinLinks.createdAt,
      expiresAt: groupJoinLinks.expiresAt,
      lastUsedAt: groupJoinLinks.lastUsedAt,
    })
    .from(groupJoinLinks)
    .where(
      and(
        eq(groupJoinLinks.groupId, groupId),
        isNull(groupJoinLinks.revokedAt),
      ),
    )
    .limit(1);
  return link ?? null;
}
