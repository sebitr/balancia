import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { groups, participants } from "./groups";
import { recurringExpenses } from "./recurring";
import {
  actorTypeEnum,
  entryDirectionEnum,
  exchangeRateSourceEnum,
  splitMethodEnum,
} from "./enums";

/**
 * How the money tables refuse to outlive the people they name.
 *
 * A participant who appears on an expense or a settlement must not be deleted
 * out from under it — that would silently rewrite a balance. `restrict` used to
 * say so, and it was wrong: Postgres checks `restrict` *immediately*, before
 * the rest of the statement runs, so it fired even when the referencing rows
 * were themselves about to be cascade-deleted. Deleting a group cascades to
 * participants and to expenses at once, and the participant leg tripped the
 * check before the expense leg had cleared the shares — so deleting any group
 * that had ever recorded an expense failed outright.
 *
 * `no action` is the same guarantee, checked at the end of the transaction
 * instead of mid-statement. Deleting a lone participant who is on an expense is
 * still refused; deleting the whole group now succeeds, because by commit time
 * the shares are gone too.
 *
 * The deferral is the load-bearing half and Drizzle cannot express it, so the
 * constraints are declared `DEFERRABLE INITIALLY DEFERRED` in a hand-written
 * migration (`0008_deferred_participant_refs.sql`). Keep this value at
 * `no action` — drizzle-kit compares only the action, so a change back to
 * `restrict` would generate a migration that reintroduces the bug.
 */
const PARTICIPANT_ON_DELETE = "no action" as const;

/**
 * An expense, or an income — one table, told apart by `direction`.
 *
 * Money columns are `bigint` holding integer minor units — never numeric,
 * never float. Drizzle is configured with `mode: "bigint"` so values arrive in
 * TypeScript as `bigint` rather than a lossy `number`.
 *
 * `amount` stays positive whichever way the money went; `direction` says which
 * way to apply it. Storing income as a negative expense would have made every
 * `SUM(amount)` in the codebase quietly wrong, and every reader would have had
 * to remember the convention.
 *
 * Currency handling:
 *   - `amount` / `currency` are always what the user entered.
 *   - In a converted group with a foreign currency, `convertedAmount`,
 *     `exchangeRate`, `exchangeRateSource` and `exchangeRateAt` freeze the
 *     conversion at write time. Reads use the stored value; rates are never
 *     re-applied to history.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /**
     * `out` for spending, `in` for money received on the group's behalf.
     * Defaulted so every row written before income existed reads as spending.
     */
    direction: entryDirectionEnum("direction").notNull().default("out"),
    description: text("description").notNull(),
    notes: text("notes"),
    category: text("category"),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    convertedAmount: bigint("converted_amount", { mode: "bigint" }),
    convertedCurrency: text("converted_currency"),
    exchangeRate: numeric("exchange_rate", { precision: 30, scale: 12 }),
    exchangeRateSource: exchangeRateSourceEnum("exchange_rate_source"),
    exchangeRateAt: timestamp("exchange_rate_at", { withTimezone: true }),
    splitMethod: splitMethodEnum("split_method").notNull(),
    /**
     * The original split inputs (percentages, shares, exact amounts) keyed by
     * participant, so the edit form can restore exactly what was chosen. The
     * authoritative allocations live in `expense_shares`.
     */
    splitInput: jsonb("split_input"),
    /** Calendar date of the expense in the group's timezone. */
    expenseDate: date("expense_date").notNull(),
    createdByActorType: actorTypeEnum("created_by_actor_type").notNull(),
    /** Participant who recorded it (a user or a guest, both are participants). */
    createdByParticipantId: uuid("created_by_participant_id").references(
      () => participants.id,
      { onDelete: "set null" },
    ),
    /**
     * Set when generated from a recurring template. The reference is declared
     * lazily because `recurring_expenses` also points back at this table; the
     * explicit return type keeps TypeScript from chasing the cycle.
     */
    recurringExpenseId: uuid("recurring_expense_id").references(
      (): AnyPgColumn => recurringExpenses.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("expenses_group_date_idx").on(
      table.groupId,
      table.expenseDate.desc(),
      table.createdAt.desc(),
    ),
    index("expenses_group_active_idx")
      .on(table.groupId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("expenses_recurring_idx").on(table.recurringExpenseId),
    check("expenses_amount_non_negative", sql`${table.amount} >= 0`),
    check("expenses_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "expenses_conversion_complete",
      sql`(${table.convertedAmount} IS NULL AND ${table.exchangeRate} IS NULL AND ${table.convertedCurrency} IS NULL)
          OR (${table.convertedAmount} IS NOT NULL AND ${table.exchangeRate} IS NOT NULL AND ${table.convertedCurrency} IS NOT NULL)`,
    ),
    check(
      "expenses_exchange_rate_positive",
      sql`${table.exchangeRate} IS NULL OR ${table.exchangeRate} > 0`,
    ),
  ],
);

/**
 * Who paid, and how much. An expense may have several payers; their
 * contributions must sum to the expense amount (enforced in the service layer
 * inside the same transaction that writes them).
 */
export const expensePayers = pgTable(
  "expense_payers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: PARTICIPANT_ON_DELETE }),
    /** Minor units in the expense's own currency. */
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    /** Minor units in the group base currency, when the group converts. */
    convertedAmount: bigint("converted_amount", { mode: "bigint" }),
  },
  (table) => [
    uniqueIndex("expense_payers_expense_participant_unique").on(
      table.expenseId,
      table.participantId,
    ),
    index("expense_payers_participant_idx").on(table.participantId),
    check("expense_payers_amount_non_negative", sql`${table.amount} >= 0`),
  ],
);

/**
 * Final per-participant allocations, already normalized from whatever split
 * method was used. Balances read only this table, so they are independent of
 * how the split was expressed.
 */
export const expenseShares = pgTable(
  "expense_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: PARTICIPANT_ON_DELETE }),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    convertedAmount: bigint("converted_amount", { mode: "bigint" }),
  },
  (table) => [
    uniqueIndex("expense_shares_expense_participant_unique").on(
      table.expenseId,
      table.participantId,
    ),
    index("expense_shares_participant_idx").on(table.participantId),
  ],
);

/**
 * A repayment between two participants. Settlements move balances without
 * being spending: totals and per-category reporting ignore them.
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    fromParticipantId: uuid("from_participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: PARTICIPANT_ON_DELETE }),
    toParticipantId: uuid("to_participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: PARTICIPANT_ON_DELETE }),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    convertedAmount: bigint("converted_amount", { mode: "bigint" }),
    convertedCurrency: text("converted_currency"),
    exchangeRate: numeric("exchange_rate", { precision: 30, scale: 12 }),
    exchangeRateSource: exchangeRateSourceEnum("exchange_rate_source"),
    exchangeRateAt: timestamp("exchange_rate_at", { withTimezone: true }),
    notes: text("notes"),
    /**
     * How the money actually changed hands — "TWINT", "Cash", "Revolut".
     *
     * Free text rather than an enum: the picker offers a known list, but
     * payment habits are regional and change faster than migrations, and a
     * method nobody has heard of is still worth recording verbatim.
     */
    paymentMethod: text("payment_method"),
    settledOn: date("settled_on").notNull(),
    createdByActorType: actorTypeEnum("created_by_actor_type").notNull(),
    createdByParticipantId: uuid("created_by_participant_id").references(
      () => participants.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("settlements_group_date_idx").on(
      table.groupId,
      table.settledOn.desc(),
      table.createdAt.desc(),
    ),
    index("settlements_group_active_idx")
      .on(table.groupId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("settlements_from_idx").on(table.fromParticipantId),
    index("settlements_to_idx").on(table.toParticipantId),
    check("settlements_amount_positive", sql`${table.amount} > 0`),
    check("settlements_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "settlements_distinct_parties",
      sql`${table.fromParticipantId} <> ${table.toParticipantId}`,
    ),
    check(
      "settlements_conversion_complete",
      sql`(${table.convertedAmount} IS NULL AND ${table.exchangeRate} IS NULL AND ${table.convertedCurrency} IS NULL)
          OR (${table.convertedAmount} IS NOT NULL AND ${table.exchangeRate} IS NOT NULL AND ${table.convertedCurrency} IS NOT NULL)`,
    ),
  ],
);
