import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { groups, participants } from "./groups";
import { expenses } from "./expenses";
import {
  actorTypeEnum,
  entryDirectionEnum,
  exchangeRateSourceEnum,
  recurrenceFrequencyEnum,
  splitMethodEnum,
} from "./enums";

/**
 * A reusable entry template that generates real entries on a schedule.
 *
 * Recurrence is a property of an entry rather than a kind of its own, so a
 * monthly rent *income* and a monthly cleaning *expense* are the same template
 * with a different `direction`.
 *
 * Scheduling is timezone-aware: the group's timezone decides when "the 1st of
 * the month" actually happens, and `nextRunAt` is a `timestamptz` so the worker
 * compares absolute instants. Payers and the split configuration are stored as
 * JSON because they are template *inputs* — the generated expense materializes
 * them into real payer and share rows.
 */
export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** Carried onto every entry this template generates. */
    direction: entryDirectionEnum("direction").notNull().default("out"),
    description: text("description").notNull(),
    notes: text("notes"),
    category: text("category"),
    /** Carried onto every entry this template generates, like `category`. */
    subcategory: text("subcategory"),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    /** Frozen rate reused for each generated occurrence in converted groups. */
    exchangeRate: numeric("exchange_rate", { precision: 30, scale: 12 }),
    exchangeRateSource: exchangeRateSourceEnum("exchange_rate_source"),
    /** [{ participantId, amount }] in minor units. */
    payers: jsonb("payers").notNull(),
    splitMethod: splitMethodEnum("split_method").notNull(),
    /** [{ participantId, value? }] — the same shape the expense form produces. */
    splitInput: jsonb("split_input").notNull(),

    frequency: recurrenceFrequencyEnum("frequency").notNull(),
    /** Every N periods, e.g. interval 2 + weekly = fortnightly. */
    interval: integer("interval").notNull().default(1),
    /** 1 = Monday … 7 = Sunday (ISO), for weekly recurrence. */
    weekday: integer("weekday"),
    /** 1–31; clamped to the last day for short months. */
    dayOfMonth: integer("day_of_month"),
    /** 1–12, for yearly recurrence. */
    monthOfYear: integer("month_of_year"),

    /** IANA timezone captured from the group at creation time. */
    timezone: text("timezone").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),

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
    index("recurring_expenses_group_idx").on(table.groupId),
    // The worker's claim query: due, active, not deleted.
    index("recurring_expenses_due_idx")
      .on(table.nextRunAt)
      .where(sql`${table.deletedAt} IS NULL AND ${table.pausedAt} IS NULL`),
    index("recurring_expenses_created_by_idx").on(table.createdByParticipantId),
    check("recurring_expenses_amount_positive", sql`${table.amount} > 0`),
    check("recurring_expenses_interval_positive", sql`${table.interval} >= 1`),
    check(
      "recurring_expenses_weekday_range",
      sql`${table.weekday} IS NULL OR (${table.weekday} BETWEEN 1 AND 7)`,
    ),
    check(
      "recurring_expenses_day_of_month_range",
      sql`${table.dayOfMonth} IS NULL OR (${table.dayOfMonth} BETWEEN 1 AND 31)`,
    ),
    check(
      "recurring_expenses_month_range",
      sql`${table.monthOfYear} IS NULL OR (${table.monthOfYear} BETWEEN 1 AND 12)`,
    ),
    check(
      "recurring_expenses_end_after_start",
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
  ],
);

/**
 * One row per generated occurrence. The unique constraint on
 * (recurring_expense_id, occurrence_date) is what makes generation idempotent:
 * a worker that runs twice — or two workers racing — can only insert one row
 * per due date, and the loser of the race skips creating a duplicate expense.
 */
export const recurringOccurrences = pgTable(
  "recurring_occurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recurringExpenseId: uuid("recurring_expense_id")
      .notNull()
      .references(() => recurringExpenses.id, { onDelete: "cascade" }),
    /** Calendar date of the occurrence in the template's timezone. */
    occurrenceDate: date("occurrence_date").notNull(),
    expenseId: uuid("expense_id").references(() => expenses.id, {
      onDelete: "set null",
    }),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("recurring_occurrences_template_date_unique").on(
      table.recurringExpenseId,
      table.occurrenceDate,
    ),
    index("recurring_occurrences_expense_idx").on(table.expenseId),
  ],
);
