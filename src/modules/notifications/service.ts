import "server-only";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import {
  groups,
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
 * Whether a row in the mute table is still silencing anything.
 *
 * A null `snoozedUntil` is a mute and lasts until it is undone. A timestamp is
 * a snooze, and once it has passed the row is spent — it stays in the table
 * until something writes over it, but it stops suppressing the moment its hour
 * comes, without anything having to sweep it.
 *
 * Exported because it is the whole of the rule, and a rule worth testing
 * without a database.
 */
export function silences(
  row: { readonly snoozedUntil: Date | null },
  now: Date,
): boolean {
  return row.snoozedUntil === null || row.snoozedUntil > now;
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
  const quiet = await tx
    .select({
      userId: notificationGroupMutes.userId,
      snoozedUntil: notificationGroupMutes.snoozedUntil,
    })
    .from(notificationGroupMutes)
    .where(
      and(
        inArray(notificationGroupMutes.userId, userIds),
        eq(notificationGroupMutes.groupId, draft.groupId),
      ),
    );

  const now = new Date();
  const mutedUsers = new Set(
    quiet.filter((row) => silences(row, now)).map((row) => row.userId),
  );
  const preferenceByUser = new Map(
    preferences.map((row) => [
      row.userId,
      {
        expenses: row.expensesEnabled,
        settlements: row.settlementsEnabled,
        recurring: row.recurringEnabled,
        imports: row.importsEnabled,
        reminders: row.remindersEnabled,
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

/**
 * Read notifications older than this stop being news and become archive.
 *
 * Kept here rather than in the component that draws the footer, because the
 * partition is a property of the query: a row on the wrong side of the line
 * must not consume one of the fifty the inbox asks for.
 */
export const ARCHIVE_AFTER_DAYS = 30;

/** As many old rows as the footer will show at once. */
const ARCHIVE_LIMIT = 20;

export interface InboxSplit {
  /** Everything still worth reading: unread at any age, plus the recent past. */
  readonly entries: NotificationEntry[];
  /** Read, and old enough to have stopped mattering. */
  readonly archived: NotificationEntry[];
}

/**
 * The inbox, split at the archive line.
 *
 * Unread rows never archive however old they are — nobody has looked at them,
 * so age is not evidence of anything. What ages out is the read half, which is
 * kept only so the reader can find it again.
 *
 * Two queries rather than one partitioned in memory: with a single `limit 50`
 * a quiet month of read rows would fill the page and push the unread ones off
 * the end, which is the opposite of what a limit is for.
 */
export async function listInbox(
  userId: string,
  options: { limit?: number; now?: Date; db?: Database } = {},
): Promise<InboxSplit> {
  const db = options.db ?? getDb();
  const cutoff = new Date(
    (options.now ?? new Date()).getTime() -
      ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );

  const columns = {
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
  };

  // Sequential: `db` may be a transaction handle, and a transaction is one
  // connection, which node-postgres will not have two queries on at once.
  const entries = await db
    .select(columns)
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        or(
          isNull(notifications.readAt),
          sql`${notifications.createdAt} >= ${cutoff}`,
        ),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(options.limit ?? 50);

  const archived = await db
    .select(columns)
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNotNull(notifications.readAt),
        sql`${notifications.createdAt} < ${cutoff}`,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(ARCHIVE_LIMIT);

  const shape = (rows: typeof entries): NotificationEntry[] =>
    rows.map((row) => ({
      ...row,
      payload: row.payload as NotificationPayload,
    }));

  return { entries: shape(entries), archived: shape(archived) };
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
    reminders: row.remindersEnabled,
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
    remindersEnabled: preferences.reminders,
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

/**
 * Group ids the reader has muted outright.
 *
 * Snoozed groups are deliberately not in here. The settings screen this feeds
 * lists standing decisions with a switch beside each; something that undoes
 * itself tomorrow morning does not belong in that list, and a switch that
 * flicks itself back would be worse than not showing it.
 */
export async function listMutedGroups(
  userId: string,
  options: { db?: Database } = {},
): Promise<string[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({ groupId: notificationGroupMutes.groupId })
    .from(notificationGroupMutes)
    .where(
      and(
        eq(notificationGroupMutes.userId, userId),
        isNull(notificationGroupMutes.snoozedUntil),
      ),
    );
  return rows.map((row) => row.groupId);
}

/** A group that is currently quiet, and whether the quiet wears off. */
export interface QuietGroup {
  readonly groupId: string;
  readonly groupName: string;
  /** Null for a mute. */
  readonly snoozedUntil: Date | null;
}

/**
 * Everything the reader has quietened and has not heard from since.
 *
 * Joined to `groups` for the name because a quietened group produces no
 * notifications at all — there is no row in the inbox left to read a name off,
 * which is the whole point of suppressing at write time.
 *
 * Spent snoozes are filtered out here rather than deleted: a row nobody is
 * reading costs nothing, and a sweep that deleted them would be one more thing
 * to run on a schedule for no benefit.
 */
export async function listQuietGroups(
  userId: string,
  options: { db?: Database; now?: Date } = {},
): Promise<QuietGroup[]> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const rows = await db
    .select({
      groupId: notificationGroupMutes.groupId,
      groupName: groups.name,
      snoozedUntil: notificationGroupMutes.snoozedUntil,
    })
    .from(notificationGroupMutes)
    .innerJoin(groups, eq(groups.id, notificationGroupMutes.groupId))
    .where(eq(notificationGroupMutes.userId, userId));

  return rows.filter((row) => silences(row, now));
}

/**
 * Silences or unsilences one group, for good.
 *
 * The caller must have checked that the user belongs to the group — muting
 * something you cannot see would leak nothing, but a row referencing a group
 * you are not in has no meaning either.
 *
 * Muting clears any snooze already on the pair: the two are one row, and the
 * stronger, deliberate decision is the one that should survive.
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
      .values({ userId, groupId, snoozedUntil: null })
      .onConflictDoUpdate({
        target: [notificationGroupMutes.userId, notificationGroupMutes.groupId],
        set: { snoozedUntil: null },
      });
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

/**
 * Quietens one group until a moment, or lifts a snooze already running.
 *
 * Passing null removes only a *snooze*. A mute and a snooze share a row, and
 * "Resume" beside a snoozed group must not quietly undo a mute the reader made
 * deliberately on the settings screen — so the delete names the shape of the
 * row it is willing to remove.
 */
export async function setGroupSnoozed(
  userId: string,
  groupId: string,
  until: Date | null,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  if (until) {
    await db
      .insert(notificationGroupMutes)
      .values({ userId, groupId, snoozedUntil: until })
      .onConflictDoUpdate({
        target: [notificationGroupMutes.userId, notificationGroupMutes.groupId],
        set: { snoozedUntil: until },
      });
    return;
  }
  await db
    .delete(notificationGroupMutes)
    .where(
      and(
        eq(notificationGroupMutes.userId, userId),
        eq(notificationGroupMutes.groupId, groupId),
        isNotNull(notificationGroupMutes.snoozedUntil),
      ),
    );
}
