import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, onlyRow, rowsAffected, type Database } from "@/lib/db/client";
import { guestInvitations, guestSessions, participants } from "@/lib/db/schema";
import { telemetry } from "@/lib/telemetry";
import { generateToken, hashToken, isWellFormedToken } from "./tokens";

/**
 * Guest sessions.
 *
 * Redeeming an invitation link exchanges the (single-use-looking, actually
 * reusable) invitation token for a *separate* session token stored in an
 * HttpOnly cookie. Two reasons this indirection matters:
 *
 *  1. The invitation token leaves the URL immediately after redemption, so it
 *     does not linger in browser history, referrer headers or proxy logs.
 *  2. Sessions can be expired and revoked independently of the link, and
 *     revoking the link cascades to every session derived from it.
 *
 * A guest session grants exactly one participant identity in exactly one
 * group. There is no path from a guest session to any other group.
 */

export const GUEST_COOKIE_NAME = "balancia_guest";

/** Guest sessions live 30 days; the link can always mint a new one. */
const GUEST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface GuestSessionContext {
  readonly sessionId: string;
  readonly groupId: string;
  readonly participantId: string;
  readonly invitationId: string;
  readonly displayName: string;
}

export class InvalidInvitationError extends Error {
  constructor(message = "This invitation link is not valid.") {
    super(message);
    this.name = "InvalidInvitationError";
  }
}

/**
 * Redeems an invitation token, creating a guest session.
 *
 * Returns the raw session token, which the caller sets as a cookie before
 * redirecting to a URL without the invitation token.
 */
export async function redeemInvitation(
  rawInvitationToken: string,
  options: { now?: Date; db?: Database } = {},
): Promise<{ token: string; context: GuestSessionContext; expiresAt: Date }> {
  if (!isWellFormedToken(rawInvitationToken)) {
    throw new InvalidInvitationError();
  }
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const invitationHash = hashToken(rawInvitationToken);

  const [invitation] = await db
    .select({
      id: guestInvitations.id,
      groupId: guestInvitations.groupId,
      participantId: guestInvitations.participantId,
      expiresAt: guestInvitations.expiresAt,
      revokedAt: guestInvitations.revokedAt,
      displayName: participants.displayName,
      participantRemovedAt: participants.removedAt,
    })
    .from(guestInvitations)
    .innerJoin(
      participants,
      eq(participants.id, guestInvitations.participantId),
    )
    .where(eq(guestInvitations.tokenHash, invitationHash))
    .limit(1);

  if (
    !invitation ||
    invitation.revokedAt !== null ||
    invitation.participantRemovedAt !== null ||
    (invitation.expiresAt !== null && invitation.expiresAt <= now)
  ) {
    throw new InvalidInvitationError();
  }

  const sessionToken = generateToken();
  const expiresAt = new Date(now.getTime() + GUEST_SESSION_TTL_MS);

  const createdRows = await db
    .insert(guestSessions)
    .values({
      invitationId: invitation.id,
      groupId: invitation.groupId,
      participantId: invitation.participantId,
      tokenHash: sessionToken.hash,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
    })
    .returning({ id: guestSessions.id });
  const created = onlyRow(createdRows, "the guest session insert");

  await db
    .update(guestInvitations)
    .set({ lastUsedAt: now })
    .where(eq(guestInvitations.id, invitation.id));

  // That somebody opened a guest link. Not which link, not which group, not
  // the name on the participant it belongs to.
  await telemetry.guestJoined();

  return {
    token: sessionToken.raw,
    expiresAt,
    context: {
      sessionId: created.id,
      groupId: invitation.groupId,
      participantId: invitation.participantId,
      invitationId: invitation.id,
      displayName: invitation.displayName,
    },
  };
}

/** Resolves a guest cookie value into a live session, or null. */
export async function resolveGuestSession(
  rawSessionToken: string | undefined,
  options: { now?: Date; db?: Database } = {},
): Promise<GuestSessionContext | null> {
  if (!rawSessionToken || !isWellFormedToken(rawSessionToken)) {
    return null;
  }
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const [session] = await db
    .select({
      id: guestSessions.id,
      groupId: guestSessions.groupId,
      participantId: guestSessions.participantId,
      invitationId: guestSessions.invitationId,
      displayName: participants.displayName,
      invitationRevokedAt: guestInvitations.revokedAt,
      participantRemovedAt: participants.removedAt,
    })
    .from(guestSessions)
    .innerJoin(participants, eq(participants.id, guestSessions.participantId))
    .innerJoin(
      guestInvitations,
      eq(guestInvitations.id, guestSessions.invitationId),
    )
    .where(
      and(
        eq(guestSessions.tokenHash, hashToken(rawSessionToken)),
        isNull(guestSessions.revokedAt),
        gt(guestSessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (
    !session ||
    session.invitationRevokedAt !== null ||
    session.participantRemovedAt !== null
  ) {
    return null;
  }

  // Best-effort activity tracking; never block a read on it.
  void db
    .update(guestSessions)
    .set({ lastSeenAt: now })
    .where(eq(guestSessions.id, session.id))
    .catch(() => undefined);

  return {
    sessionId: session.id,
    groupId: session.groupId,
    participantId: session.participantId,
    invitationId: session.invitationId,
    displayName: session.displayName,
  };
}

/** Revokes every session derived from an invitation. Used when a link is revoked. */
export async function revokeSessionsForInvitation(
  invitationId: string,
  options: { now?: Date; db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const revoked = await db
    .update(guestSessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(guestSessions.invitationId, invitationId),
        isNull(guestSessions.revokedAt),
      ),
    )
    .returning({ id: guestSessions.id });
  return revoked.length;
}

/** Deletes expired guest sessions. Called by a scheduled job. */
export async function pruneGuestSessions(
  now: Date = new Date(),
): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(guestSessions)
    .where(sql`${guestSessions.expiresAt} < ${now}`);
  return rowsAffected(deleted);
}
