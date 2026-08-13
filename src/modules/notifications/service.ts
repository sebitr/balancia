import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import {
  notificationGroupMutes,
  notificationPreferences,
  notifications,
  participants,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { publish, QUEUES } from "@/lib/jobs/queue";
import {
  CATEGORY_BY_TYPE,
  DEFAULT_PREFERENCES,
  type NotificationEntry,
  type NotificationPayload,
  type NotificationPreferences,
  type NotificationType,
} from "./types";

/**
 * Raising and reading notifications.
 *
 * Two rules shape this module:
 *
 *  1. A notification is written in the same transaction as the change it
 *     describes, exactly like an activity event. The inbox therefore cannot
 *     announce an expense that was rolled back.
 *  2. Push delivery happens *after* that transaction commits, because it is a
 *     network call to a third party. `dispatchNotifications` hands the ids to
 *     the worker; if that fails, or if the process dies first, the delivery
 *     sweep picks the rows up by their null `pushed_at`. Nothing is lost, and
 *     nothing is sent twice.
 */

export interface NotificationDraft {
  readonly type: NotificationType;
  readonly groupId: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  /** Who caused it. Null for something the system did on a schedule. */
  readonly actorLabel?: string | null;
  readonly payload: NotificationPayload;
  /**
   * The people the change concerns. Their linked accounts are the audience;
   * participants with no account (guests) are silently skipped, having nowhere
   * to be reached.
   */
  readonly participantIds?: readonly string[];
  /** Accounts to notify directly, when the audience is not a participant list. */
  readonly userIds?: readonly string[];
  /** Never tell someone about their own action. */
  readonly excludeUserId?: string | null;
}

/**
 * Resolves who actually gets told, honouring both switches in one query.
 *
 * A missing preferences row means "everything on" — a new account should not
 * need a write before it can be notified — which is why this is a left join
 * with a null-tolerant condition rather than an inner join.
 */
async function resolveRecipients(
  tx: Database,
  draft: NotificationDraft,
): Promise<string[]> {
  const candidates = new Set<string>(draft.userIds ?? []);

  if (draft.participantIds?.length) {
    const linked = await tx
      .select({ userId: participants.userId })
      .from(participants)
      .where(
        and(
          eq(participants.groupId, draft.groupId),
          inArray(participants.id, [...new Set(draft.participantIds)]),
          isNull(participants.removedAt),
        ),
      );
    for (const row of linked) {
      if (row.userId) candidates.add(row.userId);
    }
  }

  if (draft.excludeUserId) candidates.delete(draft.excludeUserId);
  if (candidates.size === 0) return [];

  const userIds = [...candidates];
  const category = CATEGORY_BY_TYPE[draft.type];

  // Sequential, not Promise.all: a transaction is one connection, and issuing
  // two queries on it concurrently is not something node-postgres supports.
  const preferences = await tx
    .select()
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, userIds));
  const muted = await tx
    .select({ userId: notificationGroupMutes.userId })
    .from(notificationGroupMutes)
    .where(
      and(
        inArray(notificationGroupMutes.userId, userIds),
        eq(notificationGroupMutes.groupId, draft.groupId),
      ),
    );

  const mutedUsers = new Set(muted.map((row) => row.userId));
  const preferenceByUser = new Map(
    preferences.map((row) => [
      row.userId,
      {
        expenses: row.expensesEnabled,
        settlements: row.settlementsEnabled,
        recurring: row.recurringEnabled,
        imports: row.importsEnabled,
      } satisfies NotificationPreferences,
    ]),
  );

  return userIds.filter((userId) => {
    if (mutedUsers.has(userId)) return false;
    // No row yet means every category is on.
    return (preferenceByUser.get(userId) ?? DEFAULT_PREFERENCES)[category];
  });
}

/**
 * Writes one notification per recipient. Always takes an explicit transaction
 * handle — pass the same one the change itself uses.
 *
 * Returns the created ids, which the caller hands to `dispatchNotifications`
 * once that transaction has committed.
 */
export async function recordNotifications(
  tx: Database,
  draft: NotificationDraft,
): Promise<string[]> {
  const recipients = await resolveRecipients(tx, draft);
  if (recipients.length === 0) return [];

  const rows = await tx
    .insert(notifications)
    .values(
      recipients.map((userId) => ({
        userId,
        groupId: draft.groupId,
        type: draft.type,
        category: CATEGORY_BY_TYPE[draft.type],
        entityType: draft.entityType,
        entityId: draft.entityId ?? null,
        actorLabel: draft.actorLabel ?? null,
        payload: draft.payload,
      })),
    )
    .returning({ id: notifications.id });

  return rows.map((row) => row.id);
}

/**
 * Asks the worker to push the given notifications now.
 *
 * Never throws: the change these describe is already committed, and a queue
 * that is momentarily unavailable must not turn a saved expense into an error
 * on someone's screen. The delivery sweep is the safety net.
 */
export async function dispatchNotifications(
  notificationIds: readonly string[],
): Promise<void> {
  if (notificationIds.length === 0) return;
  try {
    await publish(QUEUES.notificationsDeliver, {
      notificationIds: [...notificationIds],
    });
  } catch (error) {
    logger.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        count: notificationIds.length,
      },
      "Could not queue push delivery; the sweep will retry",
    );
  }
}

export interface ListNotificationsOptions {
  readonly limit?: number;
  readonly before?: Date;
  readonly db?: Database;
}

/** The inbox, newest first. Always scoped to the reader's own rows. */
export async function listNotifications(
  userId: string,
  options: ListNotificationsOptions = {},
): Promise<NotificationEntry[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      id: notifications.id,
      groupId: notifications.groupId,
      type: notifications.type,
      category: notifications.category,
      entityType: notifications.entityType,
      entityId: notifications.entityId,
      actorLabel: notifications.actorLabel,
      payload: notifications.payload,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(
      options.before
        ? and(
            eq(notifications.userId, userId),
            sql`${notifications.createdAt} < ${options.before}`,
          )
        : eq(notifications.userId, userId),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(options.limit ?? 50);

  return rows.map((row) => ({
    ...row,
    payload: row.payload as NotificationPayload,
  }));
}

/** How many unread notifications the badge should show. */
export async function countUnread(
  userId: string,
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

/**
 * Marks notifications read. With no ids, marks everything the reader has.
 * Scoped by `userId` in the same statement, so a guessed id changes nothing.
 */
export async function markRead(
  userId: string,
  notificationIds?: readonly string[],
  options: { db?: Database; now?: Date } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  if (notificationIds && notificationIds.length === 0) return 0;

  const rows = await db
    .update(notifications)
    .set({ readAt: options.now ?? new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ...(notificationIds
          ? [inArray(notifications.id, [...notificationIds])]
          : []),
      ),
    )
    .returning({ id: notifications.id });

  return rows.length;
}

/** The reader's switches, with the "no row yet" default applied. */
export async function getPreferences(
  userId: string,
  options: { db?: Database } = {},
): Promise<NotificationPreferences> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  if (!row) return DEFAULT_PREFERENCES;
  return {
    expenses: row.expensesEnabled,
    settlements: row.settlementsEnabled,
    recurring: row.recurringEnabled,
    imports: row.importsEnabled,
  };
}

export async function savePreferences(
  userId: string,
  preferences: NotificationPreferences,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  const values = {
    expensesEnabled: preferences.expenses,
    settlementsEnabled: preferences.settlements,
    recurringEnabled: preferences.recurring,
    importsEnabled: preferences.imports,
    updatedAt: new Date(),
  };
  await db
    .insert(notificationPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: values,
    });
}

/** Group ids the reader has silenced. */
export async function listMutedGroups(
  userId: string,
  options: { db?: Database } = {},
): Promise<string[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({ groupId: notificationGroupMutes.groupId })
    .from(notificationGroupMutes)
    .where(eq(notificationGroupMutes.userId, userId));
  return rows.map((row) => row.groupId);
}

/**
 * Silences or unsilences one group.
 *
 * The caller must have checked that the user belongs to the group — muting
 * something you cannot see would leak nothing, but a row referencing a group
 * you are not in has no meaning either.
 */
export async function setGroupMuted(
  userId: string,
  groupId: string,
  muted: boolean,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  if (muted) {
    await db
      .insert(notificationGroupMutes)
      .values({ userId, groupId })
      .onConflictDoNothing();
    return;
  }
  await db
    .delete(notificationGroupMutes)
    .where(
      and(
        eq(notificationGroupMutes.userId, userId),
        eq(notificationGroupMutes.groupId, groupId),
      ),
    );
}
