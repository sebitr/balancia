import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { groups } from "./groups";
import { users } from "./auth";

/**
 * Notifications: what happened, who should hear about it, and where to send it.
 *
 * Only registered users are reachable. A guest is a link holder with no
 * account, no stored contact detail and nowhere to deliver to — by design, and
 * the notification code treats an unlinked participant as simply not a
 * recipient rather than as an error.
 */

export const notificationTypeEnum = pgEnum("notification_type", [
  "expense.created",
  "expense.updated",
  "expense.deleted",
  "settlement.created",
  "settlement.updated",
  "settlement.deleted",
  "recurring.generated",
  "import.completed",
  "reminder.received",
]);

/**
 * The switches a person actually has an opinion about. Kept coarser than the
 * type list above: nobody wants to decide about "expense.updated" separately
 * from "expense.deleted".
 */
export const notificationCategoryEnum = pgEnum("notification_category", [
  "expenses",
  "settlements",
  "recurring",
  "imports",
  "reminders",
]);

/**
 * One browser or installed app that agreed to receive push messages.
 *
 * The endpoint is a URL at a push service (Google's, Mozilla's, Apple's) that
 * identifies this device to that service; the two keys encrypt payloads so the
 * service relays ciphertext it cannot read. All three come from the browser's
 * `PushSubscription` and none of them is a Balancia credential — but the
 * endpoint is a capability to send to that device, so it is never logged and
 * never leaves the server.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    /** base64url P-256 public key of the subscription (`keys.p256dh`). */
    p256dh: text("p256dh").notNull(),
    /** base64url 16-byte auth secret (`keys.auth`). */
    auth: text("auth").notNull(),
    /** Coarse label for the "your devices" list. Never used for anything else. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    /**
     * Consecutive temporary failures. A subscription the push service has
     * given up on is deleted outright (404/410); this only tracks the ones
     * that keep timing out, so they can be retired eventually.
     */
    failureCount: integer("failure_count").notNull().default(0),
  },
  (table) => [
    // The endpoint identifies the device globally: re-subscribing on the same
    // browser must update the row rather than accumulate duplicates.
    uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
    index("push_subscriptions_user_idx").on(table.userId),
  ],
);

/**
 * One thing one person is told about — the in-app inbox row and, at the same
 * time, the outbox that push delivery reads.
 *
 * Written inside the transaction that made the change it describes, exactly
 * like an activity event, so the inbox can never claim something the ledger
 * does not show. Push is sent afterwards: it is external I/O and must not run
 * inside a transaction that may still roll back.
 *
 * `payload` holds the facts needed to render the line — an amount, a
 * description, who did it — never pre-rendered text, because the reader may
 * change language between the event and reading it.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    category: notificationCategoryEnum("category").notNull(),
    /** What to link to: "expense", "settlement", "group", "import". */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    /** Display name of whoever caused it, captured so history survives renames. */
    actorLabel: text("actor_label"),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    /**
     * When push delivery last ran for this row — success or not. Null means it
     * has never been attempted, which is what the sweep looks for; claiming a
     * row by stamping this is what stops the queue job and the sweep from
     * both pushing the same notification.
     */
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
  },
  (table) => [
    index("notifications_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    // The unread badge counts through this, so keep it to the unread rows.
    index("notifications_unread_idx")
      .on(table.userId)
      .where(sql`${table.readAt} IS NULL`),
    // The delivery sweep's only query.
    index("notifications_pending_push_idx")
      .on(table.createdAt)
      .where(sql`${table.pushedAt} IS NULL`),
    index("notifications_group_idx").on(table.groupId),
  ],
);

/**
 * Per-user switches. A missing row means "everything on", so a new account
 * behaves sensibly without a write at registration.
 */
export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  expensesEnabled: boolean("expenses_enabled").notNull().default(true),
  settlementsEnabled: boolean("settlements_enabled").notNull().default(true),
  recurringEnabled: boolean("recurring_enabled").notNull().default(true),
  importsEnabled: boolean("imports_enabled").notNull().default(true),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Groups a person has silenced.
 *
 * A row's presence is the mute — there is no `muted` boolean to disagree with
 * it. Muting stops the notification being created at all, rather than hiding
 * it afterwards, so a muted group leaves nothing behind to read.
 */
export const notificationGroupMutes = pgTable(
  "notification_group_mutes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    mutedAt: timestamp("muted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.groupId] }),
    index("notification_group_mutes_user_idx").on(table.userId),
  ],
);
