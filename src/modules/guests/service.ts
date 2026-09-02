import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import {
  expenses,
  groupMembers,
  groups,
  guestInvitations,
  guestSessions,
  participants,
  users,
} from "@/lib/db/schema";
import {
  resolveGuestSession,
  revokeSessionsForInvitation,
} from "@/lib/security/guest-session";
import { recordActivity } from "@/modules/activity/service";
import { logger } from "@/lib/logger";

/**
 * Turning a guest into a member.
 *
 * A guest link identifies a *participant*, not a person: the participant row
 * already holds their balance and the expenses they added, and `participants.
 * userId` is the seam the schema left for exactly this moment. Claiming is
 * therefore not a migration of data but a single link — plus the membership
 * row that gives the new account a role, and the retirement of the link that
 * stood in for the account until now.
 *
 * It runs on *any* authentication that happens while a guest cookie is
 * present, not only on registration: an instance with SMTP configured issues
 * no session at sign-up, so a register-only claim would revoke the guest's
 * link while they still could not sign in.
 */

export type ClaimOutcome =
  /** No live guest session behind the cookie — the ordinary case. */
  | { readonly status: "none" }
  /**
   * The account is already a participant of that group. Merging two identities
   * is a different feature; the claim is skipped and the guest session left
   * alone, so signing out still returns them to it.
   */
  | { readonly status: "conflict"; readonly groupId: string }
  | { readonly status: "claimed"; readonly groupId: string };

/**
 * Links the participant behind a guest cookie to a user account.
 *
 * Safe to call with no cookie, a stale cookie or a revoked one: all of those
 * are `none`. Never throws for the sake of an authentication that has already
 * succeeded — the caller is mid sign-in, and a failed claim must not cost the
 * person their session.
 */
export async function claimGuestSession(
  userId: string,
  rawGuestToken: string | undefined,
  options: { db?: Database; now?: Date } = {},
): Promise<ClaimOutcome> {
  const session = await resolveGuestSession(rawGuestToken, options);
  if (!session) return { status: "none" };

  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const { groupId, participantId, invitationId, displayName } = session;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(eq(participants.groupId, groupId), eq(participants.userId, userId)),
      )
      .limit(1);

    if (existing) {
      return { status: "conflict", groupId } as const;
    }

    // `userId IS NULL` in the predicate rather than in a prior read: two
    // claims racing on one link must not both believe they won.
    const linked = await tx
      .update(participants)
      .set({ userId, updatedAt: now })
      .where(
        and(eq(participants.id, participantId), isNull(participants.userId)),
      )
      .returning({ id: participants.id });

    if (linked.length === 0) {
      return { status: "conflict", groupId } as const;
    }

    /*
     * A group started with no account has no owner until now.
     *
     * Its creator's seat is a guest like any other, and claiming it is what
     * makes the account the owner: the door — who is let in, whose link is
     * live — is theirs from this moment, and the group gets a creator on
     * record. Any other seat in any other group joins as a member, as it
     * always did; the owner row is the tie-breaker, not the creator column.
     */
    const [owner] = await tx
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, "owner")),
      )
      .limit(1);
    const role = owner ? "member" : "owner";

    await tx
      .insert(groupMembers)
      .values({ groupId, userId, participantId, role });

    if (role === "owner") {
      await tx
        .update(groups)
        .set({ createdByUserId: userId, updatedAt: now })
        .where(and(eq(groups.id, groupId), isNull(groups.createdByUserId)));
    }

    // The link stood in for an account. Now that the account exists, it is
    // retired — with every session derived from it, which is what makes the
    // old URL stop opening the group.
    await tx
      .update(guestInvitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(guestInvitations.id, invitationId),
          isNull(guestInvitations.revokedAt),
        ),
      );
    await revokeSessionsForInvitation(invitationId, { db: tx, now });

    await recordActivity(tx, {
      groupId,
      action: "member.added",
      entityType: "group_member",
      entityId: participantId,
      actorType: "user",
      actorUserId: userId,
      actorParticipantId: participantId,
      actorLabel: displayName,
      metadata: { via: "guest_link" },
    });

    logger.info({ groupId, participantId }, "Guest session claimed");
    return { status: "claimed", groupId } as const;
  });
}

/**
 * Who sent the invitation this session came from.
 *
 * The invite screen greets the guest by naming them; `GuestActor` carries the
 * session but not the link behind it, so this walks back to the creator. Null
 * whenever the account that created the link is gone.
 */
export async function describeGuestSession(
  sessionId: string,
  options: { db?: Database } = {},
): Promise<{ inviterName: string | null }> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({ inviterName: users.name })
    .from(guestSessions)
    .innerJoin(
      guestInvitations,
      eq(guestInvitations.id, guestSessions.invitationId),
    )
    .leftJoin(users, eq(users.id, guestInvitations.createdByUserId))
    .where(eq(guestSessions.id, sessionId))
    .limit(1);

  return { inviterName: row?.inviterName ?? null };
}

/** One expense this participant recorded themselves. */
export interface GuestContribution {
  readonly id: string;
  readonly description: string;
  readonly amount: bigint;
  readonly currency: string;
}

/** Only what they added, and only what still stands. */
function addedBy(participantId: string) {
  return and(
    eq(expenses.createdByParticipantId, participantId),
    isNull(expenses.deletedAt),
  );
}

/**
 * How many expenses this participant added.
 *
 * The guest widget names the number, so it is a count rather than a list —
 * and it is only ever asked on the guest branch of the overview.
 */
export async function countContributions(
  participantId: string,
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({ total: count(expenses.id) })
    .from(expenses)
    .where(addedBy(participantId));
  return row?.total ?? 0;
}

/** The most recent of those expenses, for the confirmation screen's list. */
export async function listContributions(
  participantId: string,
  options: { db?: Database; limit?: number } = {},
): Promise<GuestContribution[]> {
  const db = options.db ?? getDb();
  return db
    .select({
      id: expenses.id,
      description: expenses.description,
      amount: expenses.amount,
      currency: expenses.currency,
    })
    .from(expenses)
    .where(addedBy(participantId))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
    .limit(options.limit ?? 5);
}
