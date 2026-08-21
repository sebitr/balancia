import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { groups } from "./groups";
import { users } from "./auth";

export const categoryMappingScopeEnum = pgEnum("category_mapping_scope", [
  "user",
  "group",
]);

/**
 * What the classifier has been taught about a merchant.
 *
 * One row per (scope, merchant). `normalized_merchant` is the *learning key*
 * produced by `merchantKey()` — the merchant with store numbers and other
 * noise removed — so `MIGROS 1234` and `MIGROS 5678` share one row.
 * `raw_merchant` keeps the last spelling seen, for display and debugging.
 *
 * Two scopes, never mixed: a group's mapping is shared by everyone in it
 * (including guests, who have no user account), a user's follows them across
 * their groups. Rows are deleted with the group or user they belong to; there
 * is no soft delete because a mapping carries no financial history.
 */
export const expenseCategoryMappings = pgTable(
  "expense_category_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: categoryMappingScopeEnum("scope").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
    rawMerchant: text("raw_merchant").notNull(),
    normalizedMerchant: text("normalized_merchant").notNull(),
    /** A canonical category ID, never a translated label. */
    category: text("category").notNull(),
    /**
     * The subcategory taught with it, when the user picked one.
     *
     * Nullable, and a mapping is perfectly useful without it: teaching that
     * Coop is groceries is worth doing even when nobody said which aisle.
     */
    subcategory: text("subcategory"),
    transactionType: text("transaction_type"),
    /** How many times this mapping has been confirmed. Starts at 1. */
    correctionCount: integer("correction_count").notNull().default(1),
    /** How many times it has been replaced by a different category. */
    conflictCount: integer("conflict_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Partial uniqueness per scope: one answer per merchant per owner.
    uniqueIndex("expense_category_mappings_group_merchant_unique")
      .on(table.groupId, table.normalizedMerchant)
      .where(sql`${table.scope} = 'group'`),
    uniqueIndex("expense_category_mappings_user_merchant_unique")
      .on(table.userId, table.normalizedMerchant)
      .where(sql`${table.scope} = 'user'`),
    index("expense_category_mappings_normalized_idx").on(
      table.normalizedMerchant,
    ),
    index("expense_category_mappings_group_idx").on(
      table.groupId,
      table.lastUsedAt.desc(),
    ),
    index("expense_category_mappings_user_idx").on(
      table.userId,
      table.lastUsedAt.desc(),
    ),
    // A mapping belongs to exactly one owner, matching its scope.
    check(
      "expense_category_mappings_scope_owner",
      sql`(${table.scope} = 'group' AND ${table.groupId} IS NOT NULL AND ${table.userId} IS NULL)
          OR (${table.scope} = 'user' AND ${table.userId} IS NOT NULL AND ${table.groupId} IS NULL)`,
    ),
    check(
      "expense_category_mappings_counts_non_negative",
      sql`${table.correctionCount} >= 0 AND ${table.conflictCount} >= 0`,
    ),
  ],
);
