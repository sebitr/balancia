import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { groups, participants } from "./groups";

/**
 * Nudges about an open debt.
 *
 * A row is written whenever someone reminds a person who owes them — including
 * the reminders that leave through the sender's own share sheet rather than as
 * a push, because the row is not a delivery receipt. It is the record that the
 * asking happened, and it is what the once-per-24-hours limit is read from.
 * Nothing here proves the message was seen; nothing in the system could.
 *
 * The debt is captured as it stood when the reminder went out. The balance
 * moves afterwards, and a reminder that said €148.60 should keep saying so.
 */

/**
 * How the message left. `push` is a notification Balancia delivered itself;
 * `share` is a draft handed to the sender's own share sheet, because the
 * recipient has no app to receive it in.
 */
export const reminderChannelEnum = pgEnum("reminder_channel", [
  "push",
  "share",
]);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** The person owed the money — the only one allowed to ask for it. */
    fromParticipantId: uuid("from_participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    toParticipantId: uuid("to_participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    channel: reminderChannelEnum("channel").notNull(),
    /** Minor units of the debt at the moment of asking. */
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The lock's only query: the most recent reminder along one debt.
    index("reminders_pair_idx").on(
      table.groupId,
      table.fromParticipantId,
      table.toParticipantId,
      table.sentAt.desc(),
    ),
    index("reminders_group_idx").on(table.groupId, table.sentAt.desc()),
    // Both participant columns are cascade targets. `reminders_pair_idx` names
    // them, but not first — an index only serves a lookup that matches its
    // leading column, so removing a participant could use neither.
    index("reminders_from_idx").on(table.fromParticipantId),
    index("reminders_to_idx").on(table.toParticipantId),
  ],
);
