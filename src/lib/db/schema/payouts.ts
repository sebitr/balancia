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

/**
 * The postal address that goes on a Swiss QR-bill.
 *
 * Only the Swiss standard needs one: the Girocode carries no address at all,
 * and every other payout method here is a phone number or a handle. So this is
 * asked for at the moment it becomes necessary — somebody saving a Swiss IBAN
 * — and never otherwise, which is why it is a table of its own rather than
 * three more nullable columns on `users` that almost nobody would fill.
 *
 * The Implementation Guidelines mark postcode and town as always required
 * under the structured-address obligation, and unstructured addresses stop
 * being accepted by the Swiss payment infrastructure on 30 September 2026.
 * Street and building number stay genuinely optional, so they are nullable
 * here and empty lines in the payload.
 *
 * It is worth being clear about who sees this: the address is *in* the QR
 * code, so anybody who owes this person money and scans it reads their
 * address. That is how a bank transfer has always worked, and it is why the
 * form that collects it says so rather than leaving somebody to find out.
 */
export const payoutAddresses = pgTable(
  "payout_addresses",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    street: text("street"),
    buildingNumber: text("building_number"),
    postalCode: text("postal_code").notNull(),
    town: text("town").notNull(),
    /** ISO 3166-1 alpha-2, upper case. */
    country: text("country").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The lengths the guidelines give, so a row can never be one the standard
    // would refuse to carry.
    check(
      "payout_addresses_street_bounded",
      sql`length(${table.street}) <= 70`,
    ),
    check(
      "payout_addresses_building_bounded",
      sql`length(${table.buildingNumber}) <= 16`,
    ),
    check(
      "payout_addresses_postal_code_bounded",
      sql`length(${table.postalCode}) BETWEEN 1 AND 16`,
    ),
    check(
      "payout_addresses_town_bounded",
      sql`length(${table.town}) BETWEEN 1 AND 35`,
    ),
    check(
      "payout_addresses_country_format",
      sql`${table.country} ~ '^[A-Z]{2}$'`,
    ),
  ],
);
