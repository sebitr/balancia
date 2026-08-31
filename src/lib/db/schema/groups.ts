import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { currencyModeEnum, groupRoleEnum } from "./enums";

/**
 * A group of people sharing expenses.
 *
 * `currencyMode` decides how balances are derived:
 *   separate  — one balance set per currency, nothing converted
 *   converted — everything converted into `baseCurrency` at a frozen rate
 * The check constraint makes the second mode impossible to save without a base
 * currency, so the invariant is enforced by PostgreSQL rather than by hope.
 */
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    currencyMode: currencyModeEnum("currency_mode")
      .notNull()
      .default("separate"),
    /** ISO 4217 code; required when currencyMode is "converted". */
    baseCurrency: text("base_currency"),
    /** IANA timezone, used for recurring-expense scheduling. */
    timezone: text("timezone").notNull().default("UTC"),
    /**
     * Optional decoration: which icon the group wears in a list, and in which
     * accent. Slugs from `@/modules/groups/icons`, not colour values — see
     * there for why. A group with no icon shows its initial instead, so both
     * stay nullable and neither is worth a default.
     */
    icon: text("icon"),
    iconColor: text("icon_color"),
    /**
     * How this group splits things when nobody says otherwise.
     *
     * "We always split 30/30/40" is the most-asked-for thing in this
     * category, and re-entering a fixed uneven split on every entry is the
     * actual grind. Saved from the split sheet, and only offered once the
     * split differs from equal-between-everyone — which is already the
     * default and needs no remembering.
     *
     * A *suggestion*, not a constraint: the form seeds from it and the reader
     * overrides it entry by entry. Null is the ordinary state.
     *
     * Held as one blob rather than columns because it is one answer — the
     * method and its numbers are meaningless apart, and a group whose method
     * says `shares` with no weights is a state nothing can render. Members it
     * names may since have been removed, so it is filtered against the real
     * roster on read rather than trusted; see `groupSplitDefault`.
     */
    defaultSplit: jsonb("default_split"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("groups_created_by_idx").on(table.createdByUserId),
    check(
      "groups_converted_requires_base_currency",
      sql`(${table.currencyMode} <> 'converted') OR (${table.baseCurrency} IS NOT NULL)`,
    ),
    check(
      "groups_base_currency_format",
      sql`${table.baseCurrency} IS NULL OR ${table.baseCurrency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "groups_icon_format",
      sql`${table.icon} IS NULL OR ${table.icon} ~ '^[a-z][a-z0-9-]{0,31}$'`,
    ),
    check(
      "groups_icon_color_format",
      sql`${table.iconColor} IS NULL OR ${table.iconColor} ~ '^[a-z][a-z0-9-]{0,31}$'`,
    ),
  ],
);

/**
 * A person in a group.
 *
 * Participant identity is deliberately independent from authentication: a
 * participant may be linked to a registered user, or exist purely as a guest
 * reachable through an invitation link. The same human can therefore be a
 * different participant row in each group, which is what lets a guest later
 * claim their history by linking `userId`.
 */
export const participants = pgTable(
  "participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    email: text("email"),
    /** Set when this participant is a registered user of this instance. */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft removal: a participant with history cannot simply disappear. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    /**
     * When this person last looked at the group overview.
     *
     * It divides the activity feed into what they have already seen and what
     * happened since, so it is stamped on the way *out* of a visit: reading the
     * old value, rendering against it, then writing the new one. A participant
     * who has never opened the group has null, and everything counts as new.
     */
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
  },
  (table) => [
    index("participants_group_idx").on(table.groupId),
    // One participant row per user per group.
    uniqueIndex("participants_group_user_unique")
      .on(table.groupId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index("participants_user_idx").on(table.userId),
  ],
);

/**
 * Membership of a registered user in a group, carrying the role.
 *
 * Separate from `participants` because roles are about *account* permissions
 * (who may delete the group) while participants are about *money* (who owes
 * what). Guests appear in `participants` only, and never gain a role.
 */
export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    role: groupRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("group_members_group_user_unique").on(
      table.groupId,
      table.userId,
    ),
    index("group_members_user_idx").on(table.userId),
    index("group_members_group_idx").on(table.groupId),
    index("group_members_participant_idx").on(table.participantId),
  ],
);
