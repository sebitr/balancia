import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import {
  activityEvents,
  expenses,
  groupMembers,
  groups,
  guestInvitations,
  participants,
  settlements,
} from "@/lib/db/schema";
import {
  AuthorizationError,
  requirePermission,
  type GroupAccess,
  type UserActor,
} from "@/lib/security/authorization";
import { generateToken } from "@/lib/security/tokens";
import { revokeSessionsForInvitation } from "@/lib/security/guest-session";
import { activityActorFrom, recordActivity } from "@/modules/activity/service";
import type {
  AddParticipantInput,
  CreateGroupInput,
  CreateInvitationInput,
  UpdateGroupInput,
} from "./schemas";

/**
 * Group, membership and participant services.
 *
 * Everything that mutates runs inside a transaction together with its activity
 * event. Reads are always scoped by an already-authorized group ID.
 */

export interface GroupSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly currencyMode: "separate" | "converted";
  readonly baseCurrency: string | null;
  readonly timezone: string;
  readonly archivedAt: Date | null;
  readonly role: "owner" | "member";
  readonly participantCount: number;
  /** The user's own participant row here — whose balance is "yours". */
  readonly participantId: string;
  /** Last time money moved in this group; the group's creation as a floor. */
  readonly lastActivityAt: Date;
  /** First few participants, oldest first, for an avatar stack. */
  readonly memberNames: readonly string[];
}

/** How many names the avatar stack on the home screen can show. */
const AVATAR_STACK_NAMES = 3;

/**
 * When the group last moved.
 *
 * `groups.updatedAt` is not this: it changes when someone renames the group and
 * stays put when an expense is added, which is the opposite of what "last
 * activity" has to mean. Postgres's `GREATEST` skips nulls, and the group's own
 * creation is included as a floor so a group nobody has touched still sorts.
 */
const lastActivityAt = sql<Date>`GREATEST(
  ${groups.createdAt},
  (SELECT max(${expenses.createdAt}) FROM ${expenses}
    WHERE ${expenses.groupId} = ${groups.id} AND ${expenses.deletedAt} IS NULL),
  (SELECT max(${settlements.createdAt}) FROM ${settlements}
    WHERE ${settlements.groupId} = ${groups.id} AND ${settlements.deletedAt} IS NULL),
  (SELECT max(${activityEvents.createdAt}) FROM ${activityEvents}
    WHERE ${activityEvents.groupId} = ${groups.id})
)`;

/** Groups the signed-in user belongs to. */
export async function listGroupsForUser(
  userId: string,
  options: { db?: Database } = {},
): Promise<GroupSummary[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      currencyMode: groups.currencyMode,
      baseCurrency: groups.baseCurrency,
      timezone: groups.timezone,
      archivedAt: groups.archivedAt,
      role: groupMembers.role,
      participantId: groupMembers.participantId,
      participantCount: sql<number>`(
        SELECT count(*)::int FROM ${participants}
        WHERE ${participants.groupId} = ${groups.id}
          AND ${participants.removedAt} IS NULL
      )`,
      // Aggregated here rather than in a second query per group: the home
      // screen needs these for every row it draws.
      memberNames: sql<string[]>`(
        SELECT coalesce(array_agg(name ORDER BY joined), '{}')
        FROM (
          SELECT ${participants.displayName} AS name,
                 ${participants.createdAt} AS joined
          FROM ${participants}
          WHERE ${participants.groupId} = ${groups.id}
            AND ${participants.removedAt} IS NULL
          ORDER BY ${participants.createdAt}
          LIMIT ${AVATAR_STACK_NAMES}
        ) AS stack
      )`,
      lastActivityAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId))
    .orderBy(asc(groups.archivedAt), desc(lastActivityAt));

  return rows;
}

export interface CreatedGroup {
  readonly id: string;
  readonly participantId: string;
}

/**
 * Creates a group, its owner membership and the owner's participant row in one
 * transaction — a group with no owner would be unreachable.
 */
export async function createGroup(
  actor: UserActor,
  input: CreateGroupInput,
  options: { db?: Database } = {},
): Promise<CreatedGroup> {
  const db = options.db ?? getDb();

  return db.transaction(async (tx) => {
    const [group] = await tx
      .insert(groups)
      .values({
        name: input.name,
        description: input.description || null,
        currencyMode: input.currencyMode,
        baseCurrency:
          input.currencyMode === "converted"
            ? (input.baseCurrency ?? null)
            : null,
        timezone: input.timezone,
        createdByUserId: actor.userId,
      })
      .returning({ id: groups.id });

    const [participant] = await tx
      .insert(participants)
      .values({
        groupId: group.id,
        displayName: input.ownerDisplayName,
        email: actor.email,
        userId: actor.userId,
      })
      .returning({ id: participants.id });

    await tx.insert(groupMembers).values({
      groupId: group.id,
      userId: actor.userId,
      participantId: participant.id,
      role: "owner",
    });

    await recordActivity(tx, {
      groupId: group.id,
      action: "group.created",
      entityType: "group",
      entityId: group.id,
      actorType: "user",
      actorUserId: actor.userId,
      actorParticipantId: participant.id,
      actorLabel: input.ownerDisplayName,
      metadata: {
        name: input.name,
        currencyMode: input.currencyMode,
        baseCurrency: input.baseCurrency ?? null,
      },
    });

    return { id: group.id, participantId: participant.id };
  });
}

export async function updateGroup(
  access: GroupAccess,
  input: UpdateGroupInput,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "manageGroupSettings");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    await tx
      .update(groups)
      .set({
        name: input.name,
        description: input.description || null,
        timezone: input.timezone,
        updatedAt: new Date(),
      })
      .where(eq(groups.id, access.groupId));

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "group.updated",
      entityType: "group",
      entityId: access.groupId,
      ...activityActorFrom(access),
      metadata: { name: input.name, timezone: input.timezone },
    });
  });
}

export async function setGroupArchived(
  access: GroupAccess,
  archived: boolean,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "manageGroupSettings");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    await tx
      .update(groups)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(groups.id, access.groupId));

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "group.archived",
      entityType: "group",
      entityId: access.groupId,
      ...activityActorFrom(access),
      metadata: { archived },
    });
  });
}

/** Permanently deletes a group. Owner only; cascades to all group data. */
export async function deleteGroup(
  access: GroupAccess,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "deleteGroup");
  const db = options.db ?? getDb();
  await db.delete(groups).where(eq(groups.id, access.groupId));
}

export interface ParticipantSummary {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly userId: string | null;
  readonly role: "owner" | "member" | "guest";
  readonly hasActiveInvitation: boolean;
  readonly invitationPrefix: string | null;
  readonly invitationExpiresAt: Date | null;
  readonly invitationLastUsedAt: Date | null;
}

export async function listParticipants(
  groupId: string,
  options: { db?: Database; includeRemoved?: boolean } = {},
): Promise<ParticipantSummary[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      id: participants.id,
      displayName: participants.displayName,
      email: participants.email,
      userId: participants.userId,
      removedAt: participants.removedAt,
      role: groupMembers.role,
      invitationId: guestInvitations.id,
      invitationPrefix: guestInvitations.tokenPrefix,
      invitationExpiresAt: guestInvitations.expiresAt,
      invitationLastUsedAt: guestInvitations.lastUsedAt,
    })
    .from(participants)
    .leftJoin(
      groupMembers,
      and(
        eq(groupMembers.participantId, participants.id),
        eq(groupMembers.groupId, groupId),
      ),
    )
    .leftJoin(
      guestInvitations,
      and(
        eq(guestInvitations.participantId, participants.id),
        isNull(guestInvitations.revokedAt),
      ),
    )
    .where(
      options.includeRemoved
        ? eq(participants.groupId, groupId)
        : and(
            eq(participants.groupId, groupId),
            isNull(participants.removedAt),
          ),
    )
    .orderBy(asc(participants.createdAt));

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    userId: row.userId,
    role: row.role ?? "guest",
    hasActiveInvitation: row.invitationId !== null,
    invitationPrefix: row.invitationPrefix,
    invitationExpiresAt: row.invitationExpiresAt,
    invitationLastUsedAt: row.invitationLastUsedAt,
  }));
}

export async function addParticipant(
  access: GroupAccess,
  input: AddParticipantInput,
  options: { db?: Database } = {},
): Promise<string> {
  requirePermission(access, "manageParticipants");
  const db = options.db ?? getDb();

  return db.transaction(async (tx) => {
    const [participant] = await tx
      .insert(participants)
      .values({
        groupId: access.groupId,
        displayName: input.displayName,
        email: input.email || null,
      })
      .returning({ id: participants.id });

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "participant.created",
      entityType: "participant",
      entityId: participant.id,
      ...activityActorFrom(access),
      metadata: { displayName: input.displayName },
    });

    return participant.id;
  });
}

export async function updateParticipant(
  access: GroupAccess,
  participantId: string,
  input: AddParticipantInput,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "manageParticipants");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(participants)
      .set({
        displayName: input.displayName,
        email: input.email || null,
        updatedAt: new Date(),
      })
      // Scoped by group: a participant ID from another group updates nothing.
      .where(
        and(
          eq(participants.id, participantId),
          eq(participants.groupId, access.groupId),
        ),
      )
      .returning({ id: participants.id });

    if (updated.length === 0) {
      throw new AuthorizationError(
        "That participant is not part of this group.",
        "notInGroup",
      );
    }

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "participant.updated",
      entityType: "participant",
      entityId: participantId,
      ...activityActorFrom(access),
      metadata: { displayName: input.displayName },
    });
  });
}

/**
 * Soft-removes a participant. Their history stays intact — deleting someone who
 * appears in past expenses would silently rewrite balances.
 */
export async function removeParticipant(
  access: GroupAccess,
  participantId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "manageParticipants");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({
        id: participants.id,
        displayName: participants.displayName,
        userId: participants.userId,
      })
      .from(participants)
      .where(
        and(
          eq(participants.id, participantId),
          eq(participants.groupId, access.groupId),
          isNull(participants.removedAt),
        ),
      )
      .limit(1);

    if (!target) {
      throw new AuthorizationError(
        "That participant is not part of this group.",
        "notInGroup",
      );
    }

    // Refuse to strand the group without an owner.
    if (target.userId) {
      const [membership] = await tx
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, access.groupId),
            eq(groupMembers.participantId, participantId),
          ),
        )
        .limit(1);
      if (membership?.role === "owner") {
        throw new AuthorizationError(
          "Transfer ownership before removing the group owner.",
        );
      }
    }

    await tx
      .update(participants)
      .set({ removedAt: new Date() })
      .where(eq(participants.id, participantId));

    // Revoke any live guest access for this participant.
    const invitations = await tx
      .update(guestInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(guestInvitations.participantId, participantId),
          isNull(guestInvitations.revokedAt),
        ),
      )
      .returning({ id: guestInvitations.id });

    for (const invitation of invitations) {
      await revokeSessionsForInvitation(invitation.id, { db: tx });
    }

    await tx
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, access.groupId),
          eq(groupMembers.participantId, participantId),
        ),
      );

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "participant.removed",
      entityType: "participant",
      entityId: participantId,
      ...activityActorFrom(access),
      metadata: { displayName: target.displayName },
    });
  });
}

export interface CreatedInvitation {
  /** Shown once. The server keeps only its hash. */
  readonly token: string;
  readonly invitationId: string;
  readonly expiresAt: Date | null;
}

/**
 * Creates (or regenerates) a guest invitation link for a participant.
 *
 * Regenerating revokes the previous link and every session derived from it —
 * that is the "revoke and regenerate" the owner needs when a link leaks.
 */
export async function createInvitation(
  access: GroupAccess,
  input: CreateInvitationInput,
  options: { db?: Database } = {},
): Promise<CreatedInvitation> {
  requirePermission(access, "manageInvitations");
  const db = options.db ?? getDb();
  const now = new Date();

  return db.transaction(async (tx) => {
    const [participant] = await tx
      .select({
        id: participants.id,
        displayName: participants.displayName,
        userId: participants.userId,
      })
      .from(participants)
      .where(
        and(
          eq(participants.id, input.participantId),
          eq(participants.groupId, access.groupId),
          isNull(participants.removedAt),
        ),
      )
      .limit(1);

    if (!participant) {
      throw new AuthorizationError(
        "That participant is not part of this group.",
        "notInGroup",
      );
    }
    if (participant.userId) {
      throw new AuthorizationError(
        "This participant already has an account; guest links are for people without one.",
      );
    }

    const superseded = await tx
      .update(guestInvitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(guestInvitations.participantId, participant.id),
          isNull(guestInvitations.revokedAt),
        ),
      )
      .returning({ id: guestInvitations.id });

    for (const invitation of superseded) {
      await revokeSessionsForInvitation(invitation.id, { db: tx });
    }

    const token = generateToken();
    const expiresAt = input.expiresInDays
      ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const [invitation] = await tx
      .insert(guestInvitations)
      .values({
        groupId: access.groupId,
        participantId: participant.id,
        tokenHash: token.hash,
        tokenPrefix: token.prefix,
        createdByUserId:
          access.actor.kind === "user" ? access.actor.userId : null,
        expiresAt,
      })
      .returning({ id: guestInvitations.id });

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "guest_link.created",
      entityType: "guest_invitation",
      entityId: invitation.id,
      ...activityActorFrom(access),
      // Note: the token itself is never recorded — only who it is for.
      metadata: {
        participantName: participant.displayName,
        expiresAt: expiresAt?.toISOString() ?? null,
        replacedPrevious: superseded.length > 0,
      },
    });

    return { token: token.raw, invitationId: invitation.id, expiresAt };
  });
}

export async function revokeInvitation(
  access: GroupAccess,
  participantId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "manageInvitations");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const revoked = await tx
      .update(guestInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(guestInvitations.participantId, participantId),
          eq(guestInvitations.groupId, access.groupId),
          isNull(guestInvitations.revokedAt),
        ),
      )
      .returning({ id: guestInvitations.id });

    for (const invitation of revoked) {
      await revokeSessionsForInvitation(invitation.id, { db: tx });
    }

    if (revoked.length > 0) {
      await recordActivity(tx, {
        groupId: access.groupId,
        action: "guest_link.revoked",
        entityType: "guest_invitation",
        entityId: revoked[0].id,
        ...activityActorFrom(access),
        metadata: { participantId },
      });
    }
  });
}
