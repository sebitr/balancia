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
import { createJoinLink, joinLinkUrl } from "@/lib/security/join-link";
import { revokeSessionsForInvitation } from "@/lib/security/guest-session";
import { telemetry } from "@/lib/telemetry";
import { activityActorFrom, recordActivity } from "@/modules/activity/service";
import {
  removeStoredReceipts,
  storageKeysOfGroup,
} from "@/modules/attachments/service";
import { loadGroupBalances } from "@/modules/balances/service";
import { OpenBalanceError } from "@/modules/balances/open-balance";
import { DEFAULT_JOIN_LINK_EXPIRY, expiryDate } from "@/modules/join/expiry";
import { rescheduleAfterUnarchive } from "@/modules/recurring/service";
import type {
  AddParticipantInput,
  CreateGroupInput,
  CreateInvitationInput,
  GroupSplitDefaultInput,
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
  /** Slugs from `./icons`; null until someone chooses one. */
  readonly icon: string | null;
  readonly iconColor: string | null;
  readonly currencyMode: "separate" | "converted";
  readonly baseCurrency: string | null;
  readonly timezone: string;
  readonly archivedAt: Date | null;
  readonly role: "owner" | "member";
  readonly participantCount: number;
  /** The signed-in user's own participant row in this group. */
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
/*
 * `mapWith` is load-bearing. Drizzle replaces the driver's timestamp parser
 * with its own and then re-applies it per column, so a raw expression like
 * this one arrives as the unparsed string unless it is told which mapper to
 * borrow — and `sql<Date>` alone is a claim TypeScript believes and Postgres
 * does not honour.
 */
const lastActivityAt = sql`GREATEST(
  ${groups.createdAt},
  (SELECT max(${expenses.createdAt}) FROM ${expenses}
    WHERE ${expenses.groupId} = ${groups.id} AND ${expenses.deletedAt} IS NULL),
  (SELECT max(${settlements.createdAt}) FROM ${settlements}
    WHERE ${settlements.groupId} = ${groups.id} AND ${settlements.deletedAt} IS NULL),
  (SELECT max(${activityEvents.createdAt}) FROM ${activityEvents}
    WHERE ${activityEvents.groupId} = ${groups.id})
)`.mapWith(groups.createdAt);

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
      icon: groups.icon,
      iconColor: groups.iconColor,
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
    // NULLS FIRST is not decoration: an active group has no `archivedAt`, and
    // PostgreSQL sorts nulls last under a plain ASC — which would file every
    // live group below the archived ones.
    .orderBy(sql`${groups.archivedAt} ASC NULLS FIRST`, desc(lastActivityAt));

  return rows;
}

/** What a group calls itself: the fields its settings screen edits. */
export interface GroupProfile {
  readonly name: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly iconColor: string | null;
}

/**
 * The group's own description of itself, for the screen that edits it.
 *
 * `GroupAccess` deliberately does not carry these: it is resolved on every
 * authorized request in the app, and three columns nobody else reads have no
 * business being fetched for all of them. The caller has already authorized
 * the group — this only reads it.
 */
export async function getGroupProfile(
  groupId: string,
  options: { db?: Database } = {},
): Promise<GroupProfile | null> {
  const db = options.db ?? getDb();
  const [group] = await db
    .select({
      name: groups.name,
      description: groups.description,
      icon: groups.icon,
      iconColor: groups.iconColor,
    })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  return group ?? null;
}

export interface CreatedGroup {
  readonly id: string;
  readonly participantId: string;
  /**
   * The group's join link, handed back the once. The screen that follows
   * creation shows it immediately; after that it is read from storage like
   * anything else, so this is a convenience rather than the only sighting.
   */
  readonly invite: {
    readonly url: string;
    readonly expiresAt: Date | null;
  };
}

/**
 * Creates a group, its owner membership, the owner's participant row and the
 * link that lets everybody else in — all in one transaction, because a group
 * with no owner would be unreachable and a group with no link would send its
 * organiser hunting through settings for the one thing the next screen is
 * about to offer them.
 */
export async function createGroup(
  actor: UserActor,
  input: CreateGroupInput,
  options: { db?: Database } = {},
): Promise<CreatedGroup> {
  const db = options.db ?? getDb();

  const created = await db.transaction(async (tx) => {
    const [group] = await tx
      .insert(groups)
      .values({
        name: input.name,
        description: input.description || null,
        icon: input.icon || null,
        iconColor: input.iconColor || null,
        currencyMode: input.currencyMode,
        /*
         * In a converted group this is the currency everything is converted
         * into. In a separate group nothing is converted and no balance code
         * reads it — every reader gates on `currencyMode === "converted"` —
         * so it is kept only as the currency to offer first when recording an
         * expense. Storing it means switching between the two modes while
         * creating the group does not throw the choice away.
         */
        baseCurrency: input.baseCurrency ?? null,
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

    // People named while creating the group. Same transaction as the group
    // itself: a half-created group with some of its members missing would be
    // worse than an outright failure the organiser can retry.
    const others = input.participantNames ?? [];
    if (others.length > 0) {
      const created = await tx
        .insert(participants)
        .values(
          others.map((displayName) => ({ groupId: group.id, displayName })),
        )
        .returning({
          id: participants.id,
          displayName: participants.displayName,
        });

      for (const person of created) {
        await recordActivity(tx, {
          groupId: group.id,
          action: "participant.created",
          entityType: "participant",
          entityId: person.id,
          actorType: "user",
          actorUserId: actor.userId,
          actorParticipantId: participant.id,
          actorLabel: input.ownerDisplayName,
          metadata: { displayName: person.displayName },
        });
      }
    }

    // The link every newcomer arrives through, minted with the group so the
    // screen after this one has something to hand over. A week by default; the
    // organiser moves it there or in settings, and moving it never replaces
    // the token.
    const inviteExpiresAt = expiryDate(DEFAULT_JOIN_LINK_EXPIRY);
    const invite = await createJoinLink(group.id, {
      createdByUserId: actor.userId,
      expiresAt: inviteExpiresAt,
      db: tx,
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

    return {
      id: group.id,
      participantId: participant.id,
      invite: {
        url: joinLinkUrl(invite.token),
        expiresAt: inviteExpiresAt,
      },
    };
  });

  // Which of the two currency modes was chosen, after the group exists. The
  // name, the description, the icon and everyone invited into it stay here.
  await telemetry.groupCreated({ currencyMode: input.currencyMode });

  return created;
}

export interface GuestCreatedGroup {
  readonly id: string;
  readonly participantId: string;
  /** The creator's own way in, to be spent into a guest session at once. */
  readonly invitationToken: string;
  /** The group's shared link, for the screen that hands it over. */
  readonly invite: {
    readonly url: string;
    readonly expiresAt: Date | null;
  };
}

/**
 * A group started by somebody with no account.
 *
 * The cold welcome used to have two doors, an account or a sign-in, and the
 * apps people like best have a third: start with a name and a group, and
 * make the account later, when there is something to keep. Everything this
 * needs already existed for the invited guest — a participant with no user, a
 * personal invitation, a session minted from it, and a claim that turns the
 * lot into an account. This is the same guest, arriving through a group of
 * their own.
 *
 * What is different is that nobody owns the group yet. `createdByUserId` is
 * null and there is no owner row; `createdByParticipantId` records the
 * creator's seat, and the account that claims *that* seat becomes the owner
 * (see `claimGuestSession`). Anybody else who makes an account first joins as
 * a member, and the join link will not hand the creator's seat to them either
 * (see `reservedForCreator` in the join module). Until then the guest runs the
 * money side of the group as any guest does, and the shared link minted here
 * — on the group's behalf, with the default expiry — is how the others arrive.
 */
export async function createGroupAsGuest(
  input: {
    readonly name: string;
    readonly displayName: string;
    readonly timezone: string;
    readonly baseCurrency: string;
  },
  options: { db?: Database } = {},
): Promise<GuestCreatedGroup> {
  const db = options.db ?? getDb();
  const now = new Date();

  const created = await db.transaction(async (tx) => {
    const [group] = await tx
      .insert(groups)
      .values({
        name: input.name,
        currencyMode: "converted",
        baseCurrency: input.baseCurrency,
        timezone: input.timezone,
        createdByUserId: null,
      })
      .returning({ id: groups.id });

    const [participant] = await tx
      .insert(participants)
      .values({
        groupId: group.id,
        displayName: input.displayName,
        userId: null,
      })
      .returning({ id: participants.id });

    // The seat whose claim makes the owner. The group row had to exist before
    // the participant could, so it is written back rather than inserted.
    await tx
      .update(groups)
      .set({ createdByParticipantId: participant.id })
      .where(eq(groups.id, group.id));

    const inviteExpiresAt = expiryDate(DEFAULT_JOIN_LINK_EXPIRY, now);
    const invite = await createJoinLink(group.id, {
      createdByUserId: null,
      expiresAt: inviteExpiresAt,
      now,
      db: tx,
    });

    // The creator's own invitation: no author, no expiry, retired by the
    // claim like any other. Its token is spent by the caller, never shown.
    const token = generateToken();
    await tx.insert(guestInvitations).values({
      groupId: group.id,
      participantId: participant.id,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      createdByUserId: null,
      expiresAt: null,
      createdAt: now,
    });

    await recordActivity(tx, {
      groupId: group.id,
      action: "group.created",
      entityType: "group",
      entityId: group.id,
      actorType: "guest",
      actorParticipantId: participant.id,
      actorLabel: input.displayName,
      metadata: {
        name: input.name,
        currencyMode: "converted",
        baseCurrency: input.baseCurrency,
      },
    });

    return {
      id: group.id,
      participantId: participant.id,
      invitationToken: token.raw,
      invite: { url: joinLinkUrl(invite.token), expiresAt: inviteExpiresAt },
    };
  });

  await telemetry.groupCreated({ currencyMode: "converted" });

  return created;
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
        // Absent means "leave as it was", empty string means "clear it". A
        // caller that does not manage the icon — the settings form — must not
        // wipe one by saying nothing about it.
        ...(input.icon === undefined ? {} : { icon: input.icon || null }),
        ...(input.iconColor === undefined
          ? {}
          : { iconColor: input.iconColor || null }),
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

/**
 * Save — or clear — the group's default split.
 *
 * No `requirePermission`: this is a suggestion the next entry seeds from, not
 * a setting that governs anybody. Being in the group, which `GroupAccess`
 * already establishes, is the whole of the right needed to say how the group
 * usually splits things.
 *
 * Unlogged in the activity feed for the same reason. A feed is what happened
 * to the money, and this did not happen to any.
 */
export async function setGroupSplitDefault(
  access: GroupAccess,
  split: GroupSplitDefaultInput,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(groups)
    .set({ defaultSplit: split, updatedAt: new Date() })
    .where(eq(groups.id, access.groupId));
}

export async function setGroupArchived(
  access: GroupAccess,
  archived: boolean,
  options: { db?: Database; now?: Date } = {},
): Promise<void> {
  requirePermission(access, "manageGroupSettings");
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ archivedAt: groups.archivedAt })
      .from(groups)
      .where(eq(groups.id, access.groupId))
      .limit(1);

    await tx
      .update(groups)
      .set({ archivedAt: archived ? now : null, updatedAt: now })
      .where(eq(groups.id, access.groupId));

    // Coming out of the archive, recurring templates pick up at their next
    // occurrence rather than back-filling the months the group spent there.
    // Only when it really was archived: un-archiving a group that never was
    // must not drop what an outage had left its templates owing.
    if (!archived && before?.archivedAt) {
      await rescheduleAfterUnarchive(tx, access.groupId, now);
    }

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

/**
 * How many people in the group are still only a name.
 *
 * The one number that says whether the invite link is still doing anything:
 * at zero everybody has an account, and the link is a door nobody needs. The
 * settings card shows it and hides itself around it, which is why this is a
 * count rather than the whole list — the list is one tap away on People.
 */
export async function countUnclaimedParticipants(
  groupId: string,
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(participants)
    .where(
      and(
        eq(participants.groupId, groupId),
        isNull(participants.userId),
        isNull(participants.removedAt),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Permanently deletes a group. Owner only; cascades to all group data.
 *
 * The receipts' files are the one part of the group the cascade cannot reach,
 * so their keys are read before the rows go and the files removed once the
 * deletion has committed. See `storageKeysOfGroup`.
 */
export async function deleteGroup(
  access: GroupAccess,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "deleteGroup");
  const db = options.db ?? getDb();
  const receipts = await db.transaction(async (tx) => {
    const keys = await storageKeysOfGroup(tx, access.groupId);
    await tx.delete(groups).where(eq(groups.id, access.groupId));
    return keys;
  });
  await removeStoredReceipts(receipts);
}

export interface ParticipantSummary {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly userId: string | null;
  readonly role: "owner" | "member" | "guest";
  /** When they were added to the group — the "joined 2 Jul" on their row. */
  readonly createdAt: Date;
  readonly hasActiveInvitation: boolean;
  readonly invitationPrefix: string | null;
  readonly invitationCreatedAt: Date | null;
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
      createdAt: participants.createdAt,
      removedAt: participants.removedAt,
      role: groupMembers.role,
      invitationId: guestInvitations.id,
      invitationPrefix: guestInvitations.tokenPrefix,
      invitationCreatedAt: guestInvitations.createdAt,
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
    createdAt: row.createdAt,
    hasActiveInvitation: row.invitationId !== null,
    invitationPrefix: row.invitationPrefix,
    invitationCreatedAt: row.invitationCreatedAt,
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

/**
 * Renames a participant, and sets the email a placeholder can be reached at.
 *
 * Once someone has an account, both of those stop being the group's business.
 * Their name is their own — nobody else in the group gets to relabel a real
 * person — and their email is the address they sign in with, which lives in
 * their account and nowhere else. So an account holder's row is editable by
 * exactly one person, themselves, and only the display name they carry inside
 * this group moves; `input.email` is dropped on the floor rather than written.
 *
 * A row with no account behind it is the opposite case: it is a label someone
 * typed for a person who is not on the app, and whoever manages participants
 * owns both halves of it.
 */
export async function updateParticipant(
  access: GroupAccess,
  participantId: string,
  input: AddParticipantInput,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "manageParticipants");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ userId: participants.userId })
      .from(participants)
      .where(
        and(
          eq(participants.id, participantId),
          eq(participants.groupId, access.groupId),
        ),
      )
      .limit(1);

    if (!target) {
      throw new AuthorizationError(
        "That participant is not part of this group.",
        "notInGroup",
      );
    }

    const hasAccount = target.userId !== null;
    if (hasAccount && participantId !== access.participantId) {
      throw new AuthorizationError(
        "Only they can change the name and email on their own account.",
        "notYourAccount",
      );
    }

    const updated = await tx
      .update(participants)
      .set({
        displayName: input.displayName,
        ...(hasAccount ? {} : { email: input.email || null }),
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
 *
 * Only once they are square. A removed person is still in every balance their
 * history touches, but no new entry can name them, so a debt they left behind
 * would sit on the settle screen with no way to record it. The People screen
 * disables the button for somebody with money outstanding; this is the rule
 * behind it, for the API and for the screen that was rendered a minute ago.
 */
export async function removeParticipant(
  access: GroupAccess,
  participantId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "removeParticipants");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    /*
     * Locked before the balance is read, and that lock is what makes the check
     * true at commit rather than only when it ran.
     *
     * Every write that names a person — an expense, a repayment, a recurring
     * occurrence, an import — takes FOR SHARE on that person's row while it
     * confirms they are still in the group. FOR NO KEY UPDATE conflicts with
     * it, so whichever arrives second waits for the other to finish. If the
     * entry was first, this waits for it to commit and the balance below, read
     * by a later statement with a fresh snapshot, includes it. If the removal
     * was first, the entry waits, re-reads the row, finds `removed_at` set and
     * is refused. Never both.
     *
     * One person's row rather than a lock on the group: entries that do not
     * name them never wait, and neither do rows that only reference them by
     * foreign key, which take KEY SHARE and do not conflict with this.
     */
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
      .limit(1)
      .for("no key update");

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
        // Ownership passes on only when the owner closes their account, so
        // the refusal points at what they can do with the group from here:
        // archive it, or delete it.
        throw new AuthorizationError(
          "The group owner cannot be removed from the group. Archive it or delete it instead.",
          "ownerNotRemovable",
        );
      }
    }

    // Every currency the group keeps, from the same engine as the screen: a
    // person square in euros and owed in francs is not square.
    const balances = await loadGroupBalances(access, {
      db: tx,
      inTransaction: true,
    });
    const outstanding = balances.currencies.some((entry) =>
      entry.balances.some(
        (balance) =>
          balance.participantId === participantId && balance.amount !== 0n,
      ),
    );
    if (outstanding) {
      throw new OpenBalanceError("participantHasBalance", target.displayName);
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

/**
 * Puts a removed participant back — the Undo behind the People screen's
 * removal toast.
 *
 * What comes back is the person, not their access. Removal revokes any live
 * invitation and kills the sessions derived from it, and neither is recoverable
 * here: the token was only ever stored as a hash, so there is nothing to
 * un-revoke even in principle. Restoring hands back the row, the history that
 * hangs off it and — for someone with an account — their membership; a guest
 * needs a fresh link. The confirmation says exactly this before anyone agrees
 * to it, so the offer of an undo is not overstated.
 */
export async function restoreParticipant(
  access: GroupAccess,
  participantId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "removeParticipants");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const [restored] = await tx
      .update(participants)
      .set({ removedAt: null })
      .where(
        and(
          eq(participants.id, participantId),
          eq(participants.groupId, access.groupId),
        ),
      )
      .returning({
        id: participants.id,
        displayName: participants.displayName,
        userId: participants.userId,
      });

    if (!restored) {
      throw new AuthorizationError(
        "That participant is not part of this group.",
        "notInGroup",
      );
    }

    /*
     * Removal deleted the membership row and with it the role it carried. The
     * owner cannot be removed at all — `removeParticipant` refuses — so the
     * only role that can ever be coming back is "member", and re-deriving it is
     * safer than trusting a role recorded somewhere else in the meantime.
     */
    if (restored.userId) {
      await tx
        .insert(groupMembers)
        .values({
          groupId: access.groupId,
          userId: restored.userId,
          participantId: restored.id,
          role: "member",
        })
        .onConflictDoNothing();
    }

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "participant.restored",
      entityType: "participant",
      entityId: participantId,
      ...activityActorFrom(access),
      metadata: { displayName: restored.displayName },
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

  const invitation = await db.transaction(async (tx) => {
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
        "This person already signs in with their own account, so they do not need a guest link.",
        "participantHasAccount",
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

  // That a guest link was made. Not for whom, not for how long, and — needless
  // to say — not the token.
  await telemetry.inviteCreated();

  return invitation;
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
