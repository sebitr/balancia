import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * How somebody wants to be paid back.
 *
 * Per account rather than per group, because a bank account does not change
 * with which trip is being settled. Ordered, because whoever owes money should
 * be shown one answer first rather than a menu — `position` is the owner's own
 * ranking, and the smallest wins.
 *
 * `method` is a payment-method code and is deliberately free text, exactly as
 * the settlements column is: the curated list decides what is *offered*, never
 * what is *allowed*, and payment habits change faster than migrations. What
 * the column does enforce is that a row cannot be half a fact — a method that
 * needs a detail cannot be stored without one, and one that needs none cannot
 * carry a stray string. Which methods need what is
 * `src/modules/payouts/fields.ts`, and that is also where a detail's shape is
 * checked before it ever reaches here.
 *
 * These are the most sensitive rows a user owns after their credentials: an
 * IBAN is not a secret, but it is a durable identifier attached to a real
 * name, and the read path is scoped to people who both share a group with the
 * owner and owe them money. Nothing here is ever included in an export of a
 * group, because it belongs to the person, not to the trip.
 */
export const payoutMethods = pgTable(
  "payout_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** A `PaymentMethodId` in practice; free text by design. */
    method: text("method").notNull(),
    /**
     * The IBAN, the phone number, the handle — empty for cash, which carries
     * nothing. Stored normalised: phone numbers and IBANs lose their spacing,
     * everything else keeps what its owner typed.
     */
    detail: text("detail").notNull().default(""),
    /** Smallest first. Whoever owes money is shown the top one. */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One row per method per person: two IBANs under "Bank transfer" is a
    // question nobody owing money can answer.
    uniqueIndex("payout_methods_user_method_unique").on(
      table.userId,
      table.method,
    ),
    index("payout_methods_user_idx").on(table.userId, table.position),
    check("payout_methods_position_positive", sql`${table.position} >= 0`),
    check(
      "payout_methods_method_format",
      sql`${table.method} ~ '^[a-z0-9_]{2,40}$'`,
    ),
    // A bound rather than a shape: what a detail has to look like depends on
    // the method, which is a question SQL has no business answering.
    check("payout_methods_detail_bounded", sql`length(${table.detail}) <= 120`),
  ],
);
