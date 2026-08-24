import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { groups, participants } from "./groups";
import { users } from "./auth";
import { actorTypeEnum } from "./enums";

export const activityActionEnum = pgEnum("activity_action", [
  "expense.created",
  "expense.updated",
  "expense.deleted",
  "expense.restored",
  "settlement.created",
  "settlement.updated",
  "settlement.deleted",
  "settlement.restored",
  "member.added",
  "member.removed",
  "member.role_changed",
  "participant.created",
  "participant.updated",
  "participant.removed",
  "participant.restored",
  "guest_link.created",
  "guest_link.revoked",
  "guest_link.redeemed",
  "recurring.created",
  "recurring.updated",
  "recurring.deleted",
  "recurring.restored",
  "recurring.generated",
  "import.completed",
  "group.created",
  "group.updated",
  "group.archived",
  "reminder.sent",
]);

/**
 * Append-only activity log.
 *
 * Every financial change writes its event inside the same transaction as the
 * change itself, so the history can never disagree with the data. There is no
 * update or delete path for these rows.
 *
 * `metadata` holds safe structured context only — amounts, descriptions,
 * participant names. Never passwords, session or invitation tokens, or receipt
 * contents.
 */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorParticipantId: uuid("actor_participant_id").references(
      () => participants.id,
      { onDelete: "set null" },
    ),
    /** Display name captured at write time, so history survives renames. */
    actorLabel: text("actor_label"),
    action: activityActionEnum("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("activity_events_group_created_idx").on(
      table.groupId,
      table.createdAt.desc(),
    ),
    index("activity_events_entity_idx").on(table.entityType, table.entityId),
  ],
);
