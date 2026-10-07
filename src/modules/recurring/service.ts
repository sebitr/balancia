import "server-only";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { getDb, type Database } from "@/lib/db/client";
import {
  expensePayers,
  expenseShares,
  expenses,
  groups,
  participants,
  recurringExpenses,
  recurringOccurrences,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
  AuthorizationError,
  requirePermission,
  type GroupAccess,
} from "@/lib/security/authorization";
import { activityActorFrom, recordActivity } from "@/modules/activity/service";
import { dispatchNotifications } from "@/modules/notifications/service";
import { recordRecurringNotification } from "@/modules/notifications/events";
import { telemetry } from "@/lib/telemetry";
import { classifyError } from "@/lib/telemetry/crash";
import { reportCrash } from "@/lib/telemetry/crash-reporter";
import type { ExchangeRateSource } from "@/modules/currencies/conversion";
import {
  classifyRateSource,
  lookupCapturedRate,
} from "@/modules/currencies/rates";
import {
  isCategoryOfOppositeDirection,
  isValidSubcategoryFor,
} from "@/modules/categorization";
import { AllocationError } from "@/modules/expenses/allocation";
import {
  ENTRY_DIRECTIONS,
  type EntryDirection,
} from "@/modules/expenses/direction";
import {
  assertParticipantsInGroup,
  prepareExpense,
} from "@/modules/expenses/service";
import {
  currencyCodeSchema,
  exchangeRateSchema,
  isoDateSchema,
  isPositiveMinorUnits,
  minorUnitsString,
  payerSchema,
  splitEntrySchema,
} from "@/modules/expenses/schemas";
import { SPLIT_METHODS, type SplitInput } from "@/modules/expenses/split";
import {
  RECURRENCE_FREQUENCIES,
  RecurrenceError,
  WEEKS_OF_MONTH,
  dueThrough,
  editWindow,
  firstOccurrence,
  firstOccurrenceDueAfter,
  laterOf,
  nextOccurrence,
  occurrenceAfter,
  occurrenceInstant,
  occurrencesUpTo,
  remainingOf,
  todayIn,
  type RecurrenceFrequency,
  type RecurrenceRule,
  type WeekOfMonth,
} from "./schedule";

/**
 * Recurring expense templates and their generation.
 *
 * Generation is idempotent by construction: each occurrence first tries to
 * insert a `(recurring_expense_id, occurrence_date)` row. If the unique index
 * rejects it, that date was already generated — by an earlier run, or by
 * another worker in the same second — and this run skips it. The expense and
 * its occurrence row commit together, so an occurrence can never be recorded
 * without the expense it claims to have produced.
 */

export const recurringInputSchema = z
  .object({
    /** A monthly rent income is this same template with `direction: "in"`. */
    direction: z.enum(ENTRY_DIRECTIONS).optional(),
    description: z.string().trim().min(1, "Describe the expense").max(200),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
    category: z.string().trim().max(60).optional().or(z.literal("")),
    subcategory: z.string().trim().max(60).optional().or(z.literal("")),
    amount: minorUnitsString,
    currency: currencyCodeSchema,
    exchangeRate: exchangeRateSchema,
    payers: z.array(payerSchema).min(1, "Add at least one payer"),
    splitMethod: z.enum(SPLIT_METHODS),
    splitEntries: z.array(splitEntrySchema).min(1),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z.coerce.number().int().min(1).max(52).default(1),
    weekday: z.coerce.number().int().min(1).max(7).optional(),
    weekOfMonth: z.enum(WEEKS_OF_MONTH.map(String)).optional(),
    dayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
    monthOfYear: z.coerce.number().int().min(1).max(12).optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional().or(z.literal("")),
    /** The other way a series ends. Mutually exclusive with `endDate`. */
    count: z.coerce.number().int().min(1).max(520).optional(),
  })
  .refine((value) => isPositiveMinorUnits(value.amount), {
    path: ["amount"],
    message: "The amount must be greater than zero",
  })
  .refine(
    (value) => value.frequency !== "weekly" || value.weekday !== undefined,
    { path: ["weekday"], message: "Choose a day of the week" },
  )
  /**
   * A monthly rule says *which* day, one way or the other.
   *
   * "On the 3rd" and "on the second Tuesday" are the two answers, and a
   * monthly template needs exactly one of them. Daily needs neither — every
   * day is the answer — and weekly answered it above.
   */
  .refine(
    (value) =>
      value.frequency !== "monthly" ||
      value.dayOfMonth !== undefined ||
      (value.weekOfMonth !== undefined && value.weekday !== undefined),
    { path: ["dayOfMonth"], message: "Choose a day of the month" },
  )
  .refine(
    (value) => value.frequency !== "yearly" || value.dayOfMonth !== undefined,
    { path: ["dayOfMonth"], message: "Choose a day of the month" },
  )
  .refine(
    (value) =>
      value.weekOfMonth === undefined || value.dayOfMonth === undefined,
    {
      path: ["weekOfMonth"],
      message:
        "A rule is on a day of the month or on a weekday of it, not both",
    },
  )
  /**
   * A series ends one way or it ends the other.
   *
   * Both at once is answerable — whichever comes first — but it is not a
   * question the sheet asks, and storing a pair nothing can produce would
   * leave a state no screen can edit back.
   */
  .refine((value) => !(value.count !== undefined && value.endDate), {
    path: ["count"],
    message: "A series ends on a date or after a number of times, not both",
  })
  // The same pair rule the one-off entry form enforces; a template writes the
  // column every occurrence will be born with.
  .refine(
    (value) =>
      isValidSubcategoryFor(value.direction, value.category, value.subcategory),
    {
      path: ["subcategory"],
      message: "That subcategory does not belong to the chosen category",
    },
  )
  /** And it has to belong to the direction. See `expenseInputSchema`. */
  .refine(
    (value) => !isCategoryOfOppositeDirection(value.direction, value.category),
    {
      path: ["category"],
      message: "That category belongs to the other kind of entry",
    },
  );

export type RecurringInput = z.infer<typeof recurringInputSchema>;

export interface RecurringSummary {
  readonly id: string;
  readonly direction: EntryDirection;
  readonly description: string;
  readonly category: string | null;
  readonly subcategory: string | null;
  readonly amount: bigint;
  readonly currency: string;
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  readonly weekday: number | null;
  readonly weekOfMonth: WeekOfMonth | null;
  readonly dayOfMonth: number | null;
  readonly monthOfYear: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly occurrenceCount: number | null;
  readonly nextRunAt: Date | null;
  readonly lastRunAt: Date | null;
  readonly pausedAt: Date | null;
  readonly timezone: string;
  readonly generatedCount: number;
}

/**
 * The stored `week_of_month` as the rule's own type.
 *
 * A `text` column, so the database can hold anything a check constraint let
 * through and a row written before the constraint existed could hold
 * something else again. Anything unrecognised reads as "no nth-weekday rule",
 * which degrades a template to its `dayOfMonth` rather than throwing at the
 * worker.
 */
function weekOfMonthFrom(value: string | null): WeekOfMonth | null {
  if (value === null) return null;
  const match = WEEKS_OF_MONTH.find((week) => String(week) === value);
  return match ?? null;
}

function ruleFrom(template: {
  frequency: RecurrenceFrequency;
  interval: number;
  weekday: number | null;
  weekOfMonth: string | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  timezone: string;
  startDate: string;
  endDate: string | null;
  occurrenceCount: number | null;
}): RecurrenceRule {
  return {
    frequency: template.frequency,
    interval: template.interval,
    weekday: template.weekday,
    weekOfMonth: weekOfMonthFrom(template.weekOfMonth),
    dayOfMonth: template.dayOfMonth,
    monthOfYear: template.monthOfYear,
    timezone: template.timezone,
    startDate: template.startDate,
    endDate: template.endDate,
    count: template.occurrenceCount,
  };
}

/**
 * Writes a template, and nothing else: its first occurrence is left for a run
 * to generate, however long ago it fell due.
 *
 * Not what to call on somebody's behalf. A person saving a series is owed the
 * entries whose dates have already come, and `setUpRecurringExpense` adds
 * those as well. This half stands alone for the tests that drive a series
 * through the worker's clock from its first day, and for the demo data, which
 * leaves its rent to the worker like a group left alone would.
 */
export async function createRecurringExpense(
  access: GroupAccess,
  input: RecurringInput,
  options: { db?: Database } = {},
): Promise<string> {
  requirePermission(access, "manageRecurring");
  const db = options.db ?? getDb();
  const timezone = access.group.timezone;

  const rule: RecurrenceRule = {
    frequency: input.frequency,
    interval: input.interval,
    weekday: input.weekday ?? null,
    weekOfMonth: weekOfMonthFrom(input.weekOfMonth ?? null),
    dayOfMonth: input.dayOfMonth ?? null,
    monthOfYear: input.monthOfYear ?? null,
    timezone,
    startDate: input.startDate,
    endDate: input.endDate || null,
    count: input.count ?? null,
  };
  const first = firstOccurrence(rule);

  /*
   * A valid rule has no first date only when its end comes before it. It has
   * nothing to add, and an end before the start is a pair the table refuses
   * outright — which used to reach the reader as a write that failed for no
   * reason they were given. The repeat sheet refuses it first; this is for
   * any caller that gets past it.
   */
  if (first === null) {
    throw new RecurrenceError("The end date is before the first one.", {
      code: "endsBeforeFirst",
    });
  }

  // A template's rate is entered once, so its provenance is decided once too —
  // against the day the template starts. Occurrences look up their own day's
  // rate where they can, and fall back on this one; see `occurrenceRate`.
  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.startDate,
  });

  const templateId = await db.transaction(async (tx) => {
    /*
     * The template is held now to the rules every occurrence will be held to
     * later: the same check that everybody named is in the group, and the same
     * preparation the worker runs, as a dry run whose result is thrown away.
     * Payers that do not add up, a split that cannot be resolved, a foreign
     * currency with no rate — each used to be accepted here and then fail at
     * the worker on every tick, where nobody who could fix it would ever see.
     * Refused here, they are refused with the same errors a one-off entry
     * gets, and every route and action already knows how to answer those.
     */
    await assertParticipantsInGroup(tx, access.groupId, [
      ...input.payers.map((payer) => payer.participantId),
      ...input.splitEntries.map((entry) => entry.participantId),
    ]);
    prepareExpense(access, input, { rateSource });

    const [template] = await tx
      .insert(recurringExpenses)
      .values({
        groupId: access.groupId,
        direction: input.direction ?? "out",
        description: input.description,
        notes: input.notes || null,
        category: input.category || null,
        subcategory: input.subcategory || null,
        amount: BigInt(input.amount),
        currency: input.currency,
        exchangeRate: input.exchangeRate || null,
        exchangeRateSource: input.exchangeRate ? rateSource : null,
        payers: input.payers,
        splitMethod: input.splitMethod,
        splitInput: input.splitEntries,
        frequency: input.frequency,
        interval: input.interval,
        weekday: input.weekday ?? null,
        weekOfMonth: input.weekOfMonth ?? null,
        dayOfMonth: input.dayOfMonth ?? null,
        monthOfYear: input.monthOfYear ?? null,
        timezone,
        startDate: input.startDate,
        endDate: input.endDate || null,
        occurrenceCount: input.count ?? null,
        nextRunAt: first ? occurrenceInstant(first, timezone) : null,
        createdByActorType: access.actor.kind,
        createdByParticipantId: access.participantId,
      })
      .returning({ id: recurringExpenses.id });

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "recurring.created",
      entityType: "recurring_expense",
      entityId: template.id,
      ...activityActorFrom(access),
      metadata: {
        description: input.description,
        frequency: input.frequency,
        interval: input.interval,
        nextOccurrence: first,
      },
    });

    return template.id;
  });

  // How often it repeats — weekly, monthly, yearly. Not what it is for, not
  // what it costs, and not when it starts.
  await telemetry.recurringExpenseCreated({ frequency: input.frequency });

  return templateId;
}

/**
 * Where a series stands the moment it has been saved, which is what the
 * person who saved it is told.
 *
 * Dates are calendar days in the group's zone, as a rule's are.
 */
export interface RecurringSetUp {
  readonly id: string;
  /** How many of its entries exist already. */
  readonly added: number;
  /** The date of the earliest of them; null when none was added. */
  readonly addedFrom: string | null;
  /** The next date it will add one on; null when it has none left. */
  readonly next: string | null;
}

/**
 * Saves a recurring expense and adds, there and then, every entry whose date
 * has already come.
 *
 * Generation used to be left to the worker's hourly tick, so a monthly bill
 * saved at 19:55 with today's date said "saved" and showed nothing: no entry,
 * no change to anybody's balance, until 20:00. Somebody who sees a
 * confirmation and no expense adds the expense again by hand, and the tick
 * then makes it twice. So the first run happens here, in the request, before
 * the answer goes back.
 *
 * It is the worker's own run — `generateTemplate` — with the same idempotency:
 * each date is claimed in `recurring_occurrences` before its expense is
 * written, so a tick that reaches the template meanwhile cannot make any of
 * them a second time, and the marker it leaves is the one the worker reads
 * next. What differs is the edge of "already come":
 *
 * - **Today counts from the first minute.** The worker waits for
 *   `GENERATION_HOUR` so that nobody's phone goes off at midnight about rent.
 *   That is a rule about unattended runs. A series saved at 07:00 is somebody
 *   adding an expense at 07:00, which notifies the group at once like any
 *   other entry; holding it for two hours would bring back the very gap this
 *   closes.
 * - **A start date in the past is caught up**, every date from it to today,
 *   under the catch-up cap every run works to. That is what the worker would
 *   do at its next tick — the recurrence sheet previews those dates as part
 *   of the series — so doing it now changes when the entries arrive, never
 *   which. Beyond the cap the worker carries on from the marker as it always
 *   has.
 * - **The person saving it is not notified** about entries they are watching
 *   being made, as nobody is about their own expense. Everybody else in the
 *   split is, as for any generated occurrence, and each still records a
 *   "recurring.generated" activity line.
 *
 * Dates are the group's, not the device's: "today" is today in the group's
 * zone, the one the schedule runs in, so a phone a day ahead of its group
 * neither makes tomorrow's entry early nor leaves today's out.
 *
 * Resuming a paused series and un-archiving a group are untouched. They move
 * the marker past what fell due meanwhile on purpose, and nothing here runs
 * for them.
 *
 * A run that throws does not undo the save. The template is committed, and
 * failing the request would invite saving it a second time; the failure is
 * logged and reported as the worker's would be, the marker stays where it
 * was, and the next tick tries again. The answer counts the entries that do
 * exist, so it is true either way.
 */
export async function setUpRecurringExpense(
  access: GroupAccess,
  input: RecurringInput,
  options: { db?: Database; now?: Date } = {},
): Promise<RecurringSetUp> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const id = await createRecurringExpense(access, input, { db });

  const [template] = await db
    .select(generationColumns)
    .from(recurringExpenses)
    .innerJoin(groups, eq(groups.id, recurringExpenses.groupId))
    .where(eq(recurringExpenses.id, id))
    .limit(1);

  const today = todayIn(template.timezone, now);
  const first = template.nextRunAt
    ? todayIn(template.timezone, template.nextRunAt)
    : null;

  if (first !== null && first <= today) {
    try {
      await generateTemplate(db, template, now, {
        through: today,
        excludeUserId:
          access.actor.kind === "user" ? access.actor.userId : null,
      });
    } catch (error) {
      await reportGenerationFailure(template, error);
    }
  }

  // Read back rather than taken from the run: a tick that won a date in the
  // same second made that entry, and it exists all the same.
  const occurrences = await db
    .select({ date: recurringOccurrences.occurrenceDate })
    .from(recurringOccurrences)
    .where(eq(recurringOccurrences.recurringExpenseId, id))
    .orderBy(asc(recurringOccurrences.occurrenceDate));
  const [marker] = await db
    .select({ nextRunAt: recurringExpenses.nextRunAt })
    .from(recurringExpenses)
    .where(eq(recurringExpenses.id, id))
    .limit(1);

  return {
    id,
    added: occurrences.length,
    addedFrom: occurrences[0]?.date ?? null,
    next: marker?.nextRunAt
      ? todayIn(template.timezone, marker.nextRunAt)
      : null,
  };
}

/**
 * A template as the entry form reopens it: every field it was saved with, and
 * the dates an edit works between.
 */
export interface RecurringDetail {
  readonly id: string;
  readonly direction: EntryDirection;
  readonly description: string;
  readonly notes: string | null;
  readonly category: string | null;
  readonly subcategory: string | null;
  readonly amount: bigint;
  readonly currency: string;
  readonly exchangeRate: string | null;
  readonly payers: readonly { participantId: string; amount: string }[];
  readonly splitMethod: SplitInput["method"];
  readonly splitEntries: readonly { participantId: string; value?: string }[];
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  readonly weekday: number | null;
  readonly weekOfMonth: WeekOfMonth | null;
  readonly dayOfMonth: number | null;
  readonly monthOfYear: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly occurrenceCount: number | null;
  readonly pausedAt: Date | null;
  readonly timezone: string;
  /** How many entries it has added. */
  readonly generatedCount: number;
  /**
   * Where an edit starts unless told otherwise, and the earliest it may — see
   * `editWindow`. Calendar days in the template's zone.
   */
  readonly edit: { readonly from: string; readonly earliest: string };
}

/**
 * One template, to be edited — or null when it is not in this group or has
 * been removed.
 *
 * Reads the group's own templates only, the way every other read here does,
 * so an id from another group answers exactly as a missing one.
 */
export async function getRecurringExpense(
  groupId: string,
  templateId: string,
  options: { db?: Database; now?: Date } = {},
): Promise<RecurringDetail | null> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const [row] = await db
    .select({
      id: recurringExpenses.id,
      direction: recurringExpenses.direction,
      description: recurringExpenses.description,
      notes: recurringExpenses.notes,
      category: recurringExpenses.category,
      subcategory: recurringExpenses.subcategory,
      amount: recurringExpenses.amount,
      currency: recurringExpenses.currency,
      exchangeRate: recurringExpenses.exchangeRate,
      payers: recurringExpenses.payers,
      splitMethod: recurringExpenses.splitMethod,
      splitInput: recurringExpenses.splitInput,
      nextRunAt: recurringExpenses.nextRunAt,
      pausedAt: recurringExpenses.pausedAt,
      ...scheduleColumns,
    })
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.id, templateId),
        eq(recurringExpenses.groupId, groupId),
        isNull(recurringExpenses.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const rule = ruleFrom(row);
  const [series, counted] = await Promise.all([
    seriesSoFar(db, row.id, rule),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.recurringExpenseId, row.id)),
  ]);

  const { nextRunAt, splitInput, payers, ...fields } = row;
  return {
    ...fields,
    weekOfMonth: weekOfMonthFrom(row.weekOfMonth),
    payers: payers as RecurringDetail["payers"],
    splitEntries: splitInput as RecurringDetail["splitEntries"],
    generatedCount: counted[0]?.total ?? 0,
    edit: editWindow({
      frequency: row.frequency,
      next: nextRunAt ? todayIn(row.timezone, nextRunAt) : null,
      last: series.last,
      today: todayIn(row.timezone, now),
    }),
  };
}

/**
 * Where a series stands once an edit has been saved — what the person who
 * saved it is told.
 */
export interface RecurringUpdate {
  readonly id: string;
  /** The next date it adds an entry on, in its zone; null when none is left. */
  readonly next: string | null;
  /** Whether it is paused. An edit leaves that as it found it. */
  readonly paused: boolean;
}

/**
 * Changes a recurring expense for the entries still to come.
 *
 * Every field the series was set up with can change, through the same checks
 * setting one up runs: the same schema, everybody named still in the group,
 * and the same dry run of the expense every occurrence will be. Entries it has
 * already added are never touched — they are the group's history, and
 * correcting one is that entry's own edit.
 *
 * The schedule starts again from `input.startDate`, held to the edit window
 * (see `editWindow`): never before the day after the last entry, never before
 * today. The next date is the edited rule's first occurrence from there, so a
 * series whose schedule did not change keeps its next date, and one whose did
 * says on the form, before it is saved, which dates it now falls on — the
 * preview is computed the same way from the same start.
 *
 * A paused series stays paused, and resuming it later moves it on from
 * wherever it then stands, as it always has. Nothing is generated here: the
 * entry form shows the next date, and the worker makes it.
 */
export async function updateRecurringExpense(
  access: GroupAccess,
  templateId: string,
  input: RecurringInput,
  options: { db?: Database; now?: Date } = {},
): Promise<RecurringUpdate> {
  requirePermission(access, "manageRecurring");
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  // Outside the transaction, as on creation: it can ask the rate provider.
  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.startDate,
  });

  return db.transaction(async (tx) => {
    const [template] = await tx
      .select({
        id: recurringExpenses.id,
        timezone: recurringExpenses.timezone,
        pausedAt: recurringExpenses.pausedAt,
      })
      .from(recurringExpenses)
      .where(
        and(
          eq(recurringExpenses.id, templateId),
          eq(recurringExpenses.groupId, access.groupId),
          isNull(recurringExpenses.deletedAt),
        ),
      )
      // Held against a run of the worker, which moves the marker this sets.
      .for("update")
      .limit(1);

    if (!template) {
      throw new AuthorizationError(
        "That template is not part of this group.",
        "notInGroup",
      );
    }

    // The checks creation runs, for the reason it runs them: a rule the
    // worker cannot turn into an entry fails there, every hour, unseen.
    await assertParticipantsInGroup(tx, access.groupId, [
      ...input.payers.map((payer) => payer.participantId),
      ...input.splitEntries.map((entry) => entry.participantId),
    ]);
    prepareExpense(access, input, { rateSource });

    const timezone = template.timezone;
    const draft: RecurrenceRule = {
      frequency: input.frequency,
      interval: input.interval,
      weekday: input.weekday ?? null,
      weekOfMonth: weekOfMonthFrom(input.weekOfMonth ?? null),
      dayOfMonth: input.dayOfMonth ?? null,
      monthOfYear: input.monthOfYear ?? null,
      timezone,
      startDate: input.startDate,
      endDate: input.endDate || null,
      count: input.count ?? null,
    };
    const series = await seriesSoFar(tx, template.id, draft);
    const { earliest } = editWindow({
      frequency: input.frequency,
      next: null,
      last: series.last,
      today: todayIn(timezone, now),
    });
    const rule: RecurrenceRule = {
      ...draft,
      startDate: laterOf(input.startDate, earliest),
    };

    // An end before the start is a series with nothing left in it, and the
    // table refuses the pair outright. Said here, in words, rather than as a
    // failed write.
    if (rule.endDate && rule.endDate < rule.startDate) {
      throw new RecurrenceError(
        "The series would end before the next date it could add.",
        { code: "seriesEndsBeforeNext" },
      );
    }

    const next =
      remainingOf(rule, series.generated) <= 0 ? null : firstOccurrence(rule);

    await tx
      .update(recurringExpenses)
      .set({
        direction: input.direction ?? "out",
        description: input.description,
        notes: input.notes || null,
        category: input.category || null,
        subcategory: input.subcategory || null,
        amount: BigInt(input.amount),
        currency: input.currency,
        exchangeRate: input.exchangeRate || null,
        exchangeRateSource: input.exchangeRate ? rateSource : null,
        payers: input.payers,
        splitMethod: input.splitMethod,
        splitInput: input.splitEntries,
        frequency: input.frequency,
        interval: input.interval,
        weekday: input.weekday ?? null,
        weekOfMonth: input.weekOfMonth ?? null,
        dayOfMonth: input.dayOfMonth ?? null,
        monthOfYear: input.monthOfYear ?? null,
        startDate: rule.startDate,
        endDate: rule.endDate,
        occurrenceCount: rule.count,
        nextRunAt: next ? occurrenceInstant(next, timezone) : null,
        updatedAt: now,
      })
      .where(eq(recurringExpenses.id, template.id));

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "recurring.updated",
      entityType: "recurring_expense",
      entityId: template.id,
      ...activityActorFrom(access),
      metadata: {
        description: input.description,
        frequency: input.frequency,
        interval: input.interval,
        nextOccurrence: next,
      },
    });

    return { id: template.id, next, paused: template.pausedAt !== null };
  });
}

/** The columns a template's rule is rebuilt from. */
const scheduleColumns = {
  frequency: recurringExpenses.frequency,
  interval: recurringExpenses.interval,
  weekday: recurringExpenses.weekday,
  weekOfMonth: recurringExpenses.weekOfMonth,
  dayOfMonth: recurringExpenses.dayOfMonth,
  monthOfYear: recurringExpenses.monthOfYear,
  timezone: recurringExpenses.timezone,
  startDate: recurringExpenses.startDate,
  endDate: recurringExpenses.endDate,
  occurrenceCount: recurringExpenses.occurrenceCount,
};

/**
 * Where a series stands: the last date it produced, and how many it has had.
 *
 * The count is what a rule ending after a count is measured against. Counted
 * rather than remembered: the occurrence rows are the record, and a column
 * tracking the same number would be a second one to keep in step. Only asked
 * for when the answer can change a decision, so it is zero for any other rule.
 */
async function seriesSoFar(
  db: Database,
  templateId: string,
  rule: RecurrenceRule,
): Promise<{ last: string | null; generated: number }> {
  const [lastOccurrence] = await db
    .select({ occurrenceDate: recurringOccurrences.occurrenceDate })
    .from(recurringOccurrences)
    .where(eq(recurringOccurrences.recurringExpenseId, templateId))
    .orderBy(sql`${recurringOccurrences.occurrenceDate} DESC`)
    .limit(1);

  const generated =
    rule.count == null
      ? 0
      : ((
          await db
            .select({ total: sql<number>`count(*)::int` })
            .from(recurringOccurrences)
            .where(eq(recurringOccurrences.recurringExpenseId, templateId))
        )[0]?.total ?? 0);

  return { last: lastOccurrence?.occurrenceDate ?? null, generated };
}

/**
 * When a template that stood still — paused, or in an archived group — next
 * runs: its first occurrence not yet due at `now`, or null when the series has
 * nothing left to give.
 *
 * The answer goes into `next_run_at`, which the worker reads as the earliest
 * date it may generate as well as the moment it is due (see
 * `generateDueOccurrences`). That is the whole of the mechanism, and it needs
 * no column of its own: the dates between the series' last occurrence and this
 * one are walked past and never written. A series that ends after a count
 * still gets all of its occurrences, because only real ones are counted.
 *
 * One marker says where to start again but cannot describe a gap, so an
 * occurrence that was already due and not yet generated when the pause began
 * is dropped with the rest. The worker reaches every due template within the
 * hour, so that is the hour before somebody pressed pause.
 */
async function resumedRunAt(
  db: Database,
  template: { id: string } & Parameters<typeof ruleFrom>[0],
  now: Date,
): Promise<Date | null> {
  const rule = ruleFrom(template);
  const series = await seriesSoFar(db, template.id, rule);
  if (remainingOf(rule, series.generated) <= 0) return null;

  const next = firstOccurrenceDueAfter(rule, now, { from: series.last });
  return next ? occurrenceInstant(next, template.timezone) : null;
}

/**
 * Pauses a template, or resumes it.
 *
 * Resuming does not back-fill. Whatever fell due while the template was
 * paused is skipped, and it picks up at its first occurrence still to come —
 * a monthly rent paused on 1 March and resumed on 20 June next arrives on
 * 1 July, not as April, May and June at once. See `resumedRunAt`.
 */
export async function setRecurringPaused(
  access: GroupAccess,
  templateId: string,
  paused: boolean,
  options: { db?: Database; now?: Date } = {},
): Promise<void> {
  requirePermission(access, "manageRecurring");
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  await db.transaction(async (tx) => {
    const [template] = await tx
      .select({
        id: recurringExpenses.id,
        description: recurringExpenses.description,
        pausedAt: recurringExpenses.pausedAt,
        ...scheduleColumns,
      })
      .from(recurringExpenses)
      .where(
        and(
          eq(recurringExpenses.id, templateId),
          eq(recurringExpenses.groupId, access.groupId),
          isNull(recurringExpenses.deletedAt),
        ),
      )
      .limit(1);

    if (!template) {
      throw new AuthorizationError(
        "That template is not part of this group.",
        "notInGroup",
      );
    }

    // Only a template that was actually paused moves. Resuming one that was
    // running would drop whatever an outage had left it owing.
    const resuming = !paused && template.pausedAt !== null;

    await tx
      .update(recurringExpenses)
      .set({
        pausedAt: paused ? now : null,
        updatedAt: now,
        ...(resuming
          ? { nextRunAt: await resumedRunAt(tx, template, now) }
          : {}),
      })
      .where(eq(recurringExpenses.id, templateId));

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "recurring.updated",
      entityType: "recurring_expense",
      entityId: templateId,
      ...activityActorFrom(access),
      // The name, so that "paused a recurring expense" says which.
      metadata: { description: template.description, paused },
    });
  });
}

export async function deleteRecurringExpense(
  access: GroupAccess,
  templateId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "manageRecurring");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const deleted = await tx
      .update(recurringExpenses)
      .set({ deletedAt: new Date(), nextRunAt: null })
      .where(
        and(
          eq(recurringExpenses.id, templateId),
          eq(recurringExpenses.groupId, access.groupId),
          isNull(recurringExpenses.deletedAt),
        ),
      )
      .returning({ description: recurringExpenses.description });

    if (deleted.length === 0) {
      throw new AuthorizationError(
        "That template is not part of this group.",
        "notInGroup",
      );
    }

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "recurring.deleted",
      entityType: "recurring_expense",
      entityId: templateId,
      ...activityActorFrom(access),
      metadata: { description: deleted[0].description },
    });
  });
}

/**
 * Puts a deleted template back — the Undo behind the removal toast.
 *
 * `next_run_at` is deliberately left null. Deletion cleared it, and the
 * scheduler already treats a null marker as "work out when this is next due"
 * — it re-derives the date from the template's last recorded occurrence, under
 * the same catch-up cap every other template runs under. Restoring therefore
 * hands the schedule back to the worker rather than guessing at a date here,
 * and a template deleted and restored inside a minute never notices the gap.
 *
 * Expenses the template already generated were never touched by the deletion;
 * they belong to the group, not to the template that produced them.
 */
export async function restoreRecurringExpense(
  access: GroupAccess,
  templateId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "manageRecurring");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const restored = await tx
      .update(recurringExpenses)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(recurringExpenses.id, templateId),
          eq(recurringExpenses.groupId, access.groupId),
          isNotNull(recurringExpenses.deletedAt),
        ),
      )
      .returning({ description: recurringExpenses.description });

    if (restored.length === 0) {
      throw new AuthorizationError(
        "That template is not part of this group.",
        "notInGroup",
      );
    }

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "recurring.restored",
      entityType: "recurring_expense",
      entityId: templateId,
      ...activityActorFrom(access),
      metadata: { description: restored[0].description },
    });
  });
}

/**
 * Moves every running template of a group that has just come out of the
 * archive on to its first occurrence still to come.
 *
 * The worker passes over an archived group's templates entirely, so their
 * markers stood still at whatever was due when the group was archived. Left
 * there, the first run afterwards would back-fill every month the group spent
 * in the archive. It is the same decision as resuming a paused template, for
 * the same reason; a template that is paused as well is left for its own
 * resume to move.
 *
 * Takes the caller's transaction, so the group and its schedules come back
 * together.
 */
export async function rescheduleAfterUnarchive(
  tx: Database,
  groupId: string,
  now: Date,
): Promise<void> {
  const templates = await tx
    .select({ id: recurringExpenses.id, ...scheduleColumns })
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.groupId, groupId),
        isNull(recurringExpenses.deletedAt),
        isNull(recurringExpenses.pausedAt),
      ),
    );

  for (const template of templates) {
    await tx
      .update(recurringExpenses)
      .set({ nextRunAt: await resumedRunAt(tx, template, now) })
      .where(eq(recurringExpenses.id, template.id));
  }
}

export async function listRecurringExpenses(
  groupId: string,
  options: { db?: Database } = {},
): Promise<RecurringSummary[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      id: recurringExpenses.id,
      direction: recurringExpenses.direction,
      description: recurringExpenses.description,
      category: recurringExpenses.category,
      subcategory: recurringExpenses.subcategory,
      amount: recurringExpenses.amount,
      currency: recurringExpenses.currency,
      frequency: recurringExpenses.frequency,
      interval: recurringExpenses.interval,
      weekday: recurringExpenses.weekday,
      weekOfMonth: recurringExpenses.weekOfMonth,
      dayOfMonth: recurringExpenses.dayOfMonth,
      monthOfYear: recurringExpenses.monthOfYear,
      startDate: recurringExpenses.startDate,
      endDate: recurringExpenses.endDate,
      occurrenceCount: recurringExpenses.occurrenceCount,
      nextRunAt: recurringExpenses.nextRunAt,
      lastRunAt: recurringExpenses.lastRunAt,
      pausedAt: recurringExpenses.pausedAt,
      timezone: recurringExpenses.timezone,
      generatedCount: sql<number>`(
        SELECT count(*)::int FROM ${recurringOccurrences}
        WHERE ${recurringOccurrences.recurringExpenseId} = ${recurringExpenses.id}
      )`,
    })
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.groupId, groupId),
        isNull(recurringExpenses.deletedAt),
      ),
    )
    .orderBy(asc(recurringExpenses.createdAt));

  // `week_of_month` is `text`, so it is narrowed here rather than trusted.
  return rows.map((row) => ({
    ...row,
    weekOfMonth: weekOfMonthFrom(row.weekOfMonth),
  }));
}

/**
 * How many recurring expenses a group has, and how many of them are running.
 *
 * What the transactions list says beside its kind chips. Running means not
 * paused; a series that has come to its end still counts, because the screen
 * the count leads to still lists it.
 */
export async function countRecurringExpenses(
  groupId: string,
  options: { db?: Database } = {},
): Promise<{ total: number; running: number }> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      running: sql<number>`(count(*) filter (where ${recurringExpenses.pausedAt} is null))::int`,
    })
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.groupId, groupId),
        isNull(recurringExpenses.deletedAt),
      ),
    );
  return { total: row?.total ?? 0, running: row?.running ?? 0 };
}

/** How often a template runs, and nothing else. */
export interface RecurrenceCadence {
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
}

/**
 * The cadence behind one generated entry.
 *
 * A detail screen states what an entry repeats at — "Monthly", "Every 2
 * weeks" — and that is the whole of what it needs from the template. Reading
 * it through `listRecurringExpenses` would load every template in the group,
 * each with a count of the occurrences it has generated, to print two words.
 *
 * Returns null when the template has since been deleted: the entries it
 * already produced stay, and they are simply one-offs now.
 */
export async function getRecurrenceCadence(
  groupId: string,
  recurringExpenseId: string,
  options: { db?: Database } = {},
): Promise<RecurrenceCadence | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({
      frequency: recurringExpenses.frequency,
      interval: recurringExpenses.interval,
    })
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.id, recurringExpenseId),
        eq(recurringExpenses.groupId, groupId),
        isNull(recurringExpenses.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** What a run reads for each template, its group's money settings beside it. */
const generationColumns = {
  id: recurringExpenses.id,
  groupId: recurringExpenses.groupId,
  direction: recurringExpenses.direction,
  description: recurringExpenses.description,
  notes: recurringExpenses.notes,
  category: recurringExpenses.category,
  subcategory: recurringExpenses.subcategory,
  amount: recurringExpenses.amount,
  currency: recurringExpenses.currency,
  exchangeRate: recurringExpenses.exchangeRate,
  payers: recurringExpenses.payers,
  splitMethod: recurringExpenses.splitMethod,
  splitInput: recurringExpenses.splitInput,
  frequency: recurringExpenses.frequency,
  interval: recurringExpenses.interval,
  weekday: recurringExpenses.weekday,
  weekOfMonth: recurringExpenses.weekOfMonth,
  dayOfMonth: recurringExpenses.dayOfMonth,
  monthOfYear: recurringExpenses.monthOfYear,
  timezone: recurringExpenses.timezone,
  startDate: recurringExpenses.startDate,
  endDate: recurringExpenses.endDate,
  occurrenceCount: recurringExpenses.occurrenceCount,
  nextRunAt: recurringExpenses.nextRunAt,
  createdByParticipantId: recurringExpenses.createdByParticipantId,
  createdAt: recurringExpenses.createdAt,
  currencyMode: groups.currencyMode,
  baseCurrency: groups.baseCurrency,
  groupName: groups.name,
  archivedAt: groups.archivedAt,
};

export interface GenerationReport {
  readonly templatesProcessed: number;
  readonly expensesCreated: number;
  readonly occurrencesSkipped: number;
  /** Templates that threw, and will be tried again on the next run. */
  readonly templatesFailed: number;
}

/**
 * Generates every occurrence that is due.
 *
 * Called by the worker on a schedule, and directly by tests. Running it twice
 * over the same window is safe and produces no duplicates — that property is
 * the point of `recurring_occurrences`.
 *
 * Each template is its own unit of failure. One that throws is logged, counted
 * in the report and passed over, and every other template on the instance
 * still generates. See the `catch` below for why its marker is left where it
 * was.
 */
export async function generateDueOccurrences(
  options: { db?: Database; now?: Date; groupId?: string } = {},
): Promise<GenerationReport> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const templates = await db
    .select(generationColumns)
    .from(recurringExpenses)
    .innerJoin(groups, eq(groups.id, recurringExpenses.groupId))
    .where(
      and(
        isNull(recurringExpenses.deletedAt),
        isNull(recurringExpenses.pausedAt),
        isNull(groups.archivedAt),
        options.groupId
          ? eq(recurringExpenses.groupId, options.groupId)
          : undefined,
        or(
          isNull(recurringExpenses.nextRunAt),
          lte(recurringExpenses.nextRunAt, now),
        ),
      ),
    );

  let expensesCreated = 0;
  let occurrencesSkipped = 0;
  let templatesFailed = 0;

  for (const template of templates) {
    try {
      // Not "today": an occurrence is due once its 09:00 has passed in the
      // group's own zone, which on a catch-up run after an outage is not the
      // same date. See `GENERATION_HOUR`.
      const run = await generateTemplate(db, template, now, {
        through: dueThrough(template.timezone, now),
      });
      expensesCreated += run.created;
      occurrencesSkipped += run.skipped;
    } catch (error) {
      /*
       * One template that cannot generate must not stop every other one on
       * the instance, which is what happened when this loop had no catch: the
       * first throw ended the run, no marker after it moved, and every group
       * behind it in the list stopped receiving its rent.
       *
       * The failing template's marker is left where it was, so it is tried
       * again on the next run. Moving it on would skip the occurrence for
       * good, silently, and a failure is often temporary — a dropped
       * connection, a deadlock. One that is not is retried hourly and logged
       * hourly, which is the point: somebody should notice. Occurrences it
       * managed before the throw have committed, and the retry resumes after
       * them.
       */
      templatesFailed += 1;
      await reportGenerationFailure(template, error);
    }
  }

  return {
    templatesProcessed: templates.length,
    expensesCreated,
    occurrencesSkipped,
    templatesFailed,
  };
}

/**
 * Logs a template that threw, and reports it.
 *
 * The log line names the template and its group and the class of error, never
 * the message: allocation messages carry amounts.
 */
async function reportGenerationFailure(
  template: { id: string; groupId: string },
  error: unknown,
): Promise<void> {
  logger.error(
    {
      recurringExpenseId: template.id,
      groupId: template.groupId,
      err: classifyError(error),
      ...(error instanceof AllocationError ? { reason: error.code } : {}),
    },
    "Recurring template failed to generate; the next run will retry it",
  );
  await reportCrash(error, "scheduler");
}

/** What one template's run produced. */
interface TemplateRun {
  readonly created: number;
  readonly skipped: number;
}

/**
 * Generates one template's occurrences up to and including `through`, and
 * moves its marker on.
 *
 * The whole of what a run does for a template, shared by the worker's tick and
 * by `setUpRecurringExpense`. The two differ only in the last date they will
 * generate — the worker waits for nine, somebody saving a series does not —
 * and in whether anybody is left out of the notifications. Throws whatever an
 * occurrence threw, with the occurrences before it committed and the marker
 * left where it was; the caller decides what a failure costs.
 */
async function generateTemplate(
  db: Database,
  template: TemplateRow,
  now: Date,
  options: { through: string; excludeUserId?: string | null },
): Promise<TemplateRun> {
  const rule = ruleFrom(template);
  const series = await seriesSoFar(db, template.id, rule);

  /*
   * `next_run_at` is the earliest date this run may generate, as well as the
   * moment the template is due. Ordinarily it is the occurrence after the last
   * one, and bounds nothing. After an outage it is the first occurrence the
   * outage missed, and everything from there is caught up. After a pause or
   * an archive, coming back moved it on to the first occurrence still to come
   * (`resumedRunAt`), and the dates in between — which fell due while the
   * template stood still — are walked past rather than generated. So is a
   * date skipped because somebody on it has left the group: it stays skipped,
   * rather than being tried again on every run after it. A null marker bounds
   * nothing, and the series picks up after its last occurrence, as a restored
   * template does.
   */
  const floor = template.nextRunAt
    ? todayIn(template.timezone, template.nextRunAt)
    : null;

  const due = occurrencesUpTo(rule, options.through, {
    from: series.last,
    notBefore: floor,
    // Cap catch-up so a template dormant for years cannot flood a group.
    maxOccurrences: 120,
    alreadyGenerated: series.generated,
  });

  let created = 0;
  let skipped = 0;
  for (const occurrenceDate of due) {
    const notificationIds = await generateSingleOccurrence(
      db,
      template,
      occurrenceDate,
      now,
      options.excludeUserId ?? null,
    );
    if (notificationIds) {
      created += 1;
      // Outside the occurrence transaction, which has already committed.
      await dispatchNotifications(notificationIds);
    } else {
      skipped += 1;
    }
  }

  // Advance the due marker even when nothing was generated, so the template
  // is not re-scanned on every tick.
  const lastGenerated = due.at(-1) ?? series.last;
  /*
   * A series that has had all its occurrences has no next one, however
   * happily the maths would go on producing dates. `nextOccurrence` sees a
   * single occurrence and cannot know, so the count is applied here — the one
   * place that knows how many there have been. Counted again rather than
   * added up, because a date skipped for a missing participant was due but is
   * not one of them.
   */
  const exhausted =
    rule.count != null &&
    remainingOf(rule, (await seriesSoFar(db, template.id, rule)).generated) <=
      0;
  // `occurrenceAfter` rather than a bare step: after an edit the last entry
  // was made under the rule's previous version, before its new start.
  let upcoming = exhausted ? null : occurrenceAfter(rule, lastGenerated);
  // Never back behind the floor this run started from, or the dates it walked
  // past would be on the table again at the next one.
  while (upcoming && floor && upcoming < floor) {
    upcoming = nextOccurrence(rule, upcoming);
  }

  await db
    .update(recurringExpenses)
    .set({
      nextRunAt: upcoming
        ? occurrenceInstant(upcoming, template.timezone)
        : null,
      lastRunAt: due.length > 0 ? now : undefined,
    })
    .where(eq(recurringExpenses.id, template.id));

  return { created, skipped };
}

/** The row shape a run selects for each template — see `generationColumns`. */
interface TemplateRow {
  id: string;
  groupId: string;
  direction: EntryDirection;
  description: string;
  notes: string | null;
  category: string | null;
  subcategory: string | null;
  amount: bigint;
  currency: string;
  exchangeRate: string | null;
  payers: unknown;
  splitMethod: SplitInput["method"];
  splitInput: unknown;
  frequency: RecurrenceFrequency;
  interval: number;
  weekday: number | null;
  weekOfMonth: string | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  timezone: string;
  startDate: string;
  endDate: string | null;
  occurrenceCount: number | null;
  nextRunAt: Date | null;
  createdByParticipantId: string | null;
  /**
   * When the template was written, which is when its typed rate is said to
   * have been captured. An edit can change that rate since, and there is no
   * column to say when; the creation stands in for it.
   */
  createdAt: Date;
  currencyMode: "separate" | "converted";
  baseCurrency: string | null;
  groupName: string;
  archivedAt: Date | null;
}

/**
 * The rate an occurrence is converted at, where it came from, and when it was
 * captured.
 *
 * A template's rate was typed once, for the day the template was written. A
 * monthly rent in dollars is still paid in dollars eighteen months later, at
 * whatever the dollar is worth by then, so each occurrence asks for its own
 * day's rate the way the entry form's suggestion does. What comes back is
 * recorded as `api`, stamped with the moment this instance fetched it — the
 * only case in which that label is true.
 *
 * With no provider, or none with a quote for that day, or one that fails, the
 * template's own rate stands in. It is `manual`, because somebody typed it,
 * and it is stamped with the template's creation, because that is when it was
 * captured. A missing quote never costs the group its occurrence, because
 * creation refuses a template that has no rate to fall back on.
 */
async function occurrenceRate(
  template: TemplateRow,
  occurrenceDate: string,
  now: Date,
): Promise<{
  rate: string | null;
  source: ExchangeRateSource;
  capturedAt: Date;
}> {
  const typed = {
    rate: template.exchangeRate,
    source: "manual" as const,
    capturedAt: template.createdAt,
  };
  if (
    template.currencyMode !== "converted" ||
    !template.baseCurrency ||
    template.currency === template.baseCurrency
  ) {
    return typed;
  }

  try {
    const quote = await lookupCapturedRate({
      from: template.currency,
      to: template.baseCurrency,
      on: occurrenceDate,
      now,
    });
    return quote
      ? { rate: quote.rate, source: "api", capturedAt: quote.capturedAt }
      : typed;
  } catch (error) {
    logger.warn(
      {
        recurringExpenseId: template.id,
        groupId: template.groupId,
        err: classifyError(error),
      },
      "Rate lookup for a recurring occurrence failed; using the template's rate",
    );
    return typed;
  }
}

/**
 * Creates one occurrence.
 *
 * Returns the notifications it wrote, for the caller to push once the
 * transaction has committed — or null when that date already existed and
 * nothing was created.
 *
 * The occurrence row is inserted first with ON CONFLICT DO NOTHING: winning
 * that insert is what grants the right to create the expense, so two workers
 * racing on the same date produce exactly one expense.
 */
async function generateSingleOccurrence(
  db: Database,
  template: TemplateRow,
  occurrenceDate: string,
  now: Date,
  excludeUserId: string | null,
): Promise<string[] | null> {
  // Before the transaction: it can be a call to the rate provider, and a
  // network round trip must not hold the occurrence's locks open.
  const rate = await occurrenceRate(template, occurrenceDate, now);

  return db
    .transaction(async (tx) => {
      const claimed = await tx
        .insert(recurringOccurrences)
        .values({
          recurringExpenseId: template.id,
          occurrenceDate,
        })
        .onConflictDoNothing({
          target: [
            recurringOccurrences.recurringExpenseId,
            recurringOccurrences.occurrenceDate,
          ],
        })
        .returning({ id: recurringOccurrences.id });

      if (claimed.length === 0) {
        return null;
      }

      const payers = template.payers as {
        participantId: string;
        amount: string;
      }[];
      const splitEntries = template.splitInput as {
        participantId: string;
        value?: string;
      }[];

      // A participant removed since the template was written would make the
      // expense unbalanced; skip generation and leave a warning rather than
      // writing corrupt financial data. FOR SHARE, like every other write that
      // names somebody: a removal waits for this occurrence to commit before
      // it reads their balance. See `removeParticipant`.
      const referenced = [
        ...payers.map((payer) => payer.participantId),
        ...splitEntries.map((entry) => entry.participantId),
      ];
      const present = await tx
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(
            eq(participants.groupId, template.groupId),
            isNull(participants.removedAt),
            inArray(participants.id, [...new Set(referenced)]),
          ),
        )
        .for("share");

      if (present.length !== new Set(referenced).size) {
        logger.warn(
          { recurringExpenseId: template.id, occurrenceDate },
          "Skipping recurring occurrence: a participant is no longer in the group",
        );
        throw new SkipOccurrence();
      }

      const prepared = prepareExpense(
        {
          group: {
            id: template.groupId,
            name: template.groupName,
            currencyMode: template.currencyMode,
            baseCurrency: template.baseCurrency,
            timezone: template.timezone,
            archivedAt: template.archivedAt,
          },
        },
        {
          amount: template.amount.toString(),
          currency: template.currency,
          exchangeRate: rate.rate ?? undefined,
          payers,
          splitMethod: template.splitMethod,
          splitEntries,
        },
        { rateSource: rate.source, now: rate.capturedAt },
      );

      const [expense] = await tx
        .insert(expenses)
        .values({
          groupId: template.groupId,
          direction: template.direction,
          description: template.description,
          notes: template.notes,
          category: template.category,
          // The generated entry is the template made real: both halves of the
          // pair travel, or a monthly "Loyer" would arrive as bare `home`.
          subcategory: template.subcategory,
          amount: prepared.amount,
          currency: prepared.currency,
          convertedAmount: prepared.convertedAmount,
          convertedCurrency: prepared.convertedCurrency,
          exchangeRate: prepared.exchangeRate,
          exchangeRateSource: prepared.exchangeRateSource,
          exchangeRateAt: prepared.exchangeRateAt,
          splitMethod: template.splitMethod,
          splitInput: prepared.splitInput,
          expenseDate: occurrenceDate,
          createdByActorType: "system",
          createdByParticipantId: template.createdByParticipantId,
          recurringExpenseId: template.id,
        })
        .returning({ id: expenses.id });

      await tx.insert(expensePayers).values(
        prepared.payers.map((payer) => ({
          expenseId: expense.id,
          participantId: payer.participantId,
          amount: payer.amount,
          convertedAmount: payer.convertedAmount,
        })),
      );
      await tx.insert(expenseShares).values(
        prepared.shares.map((share) => ({
          expenseId: expense.id,
          participantId: share.participantId,
          amount: share.amount,
          convertedAmount: share.convertedAmount,
        })),
      );

      await tx
        .update(recurringOccurrences)
        .set({ expenseId: expense.id })
        .where(eq(recurringOccurrences.id, claimed[0].id));

      await recordActivity(tx, {
        groupId: template.groupId,
        action: "recurring.generated",
        entityType: "expense",
        entityId: expense.id,
        actorType: "system",
        actorLabel: "Scheduled",
        metadata: {
          description: template.description,
          amount: prepared.amount.toString(),
          currency: prepared.currency,
          direction: template.direction,
          occurrenceDate,
          recurringExpenseId: template.id,
        },
      });

      return recordRecurringNotification(tx, {
        groupId: template.groupId,
        groupName: template.groupName,
        expenseId: expense.id,
        description: template.description,
        amount: prepared.amount,
        currency: prepared.currency,
        participantIds: [
          ...prepared.payers.map((payer) => payer.participantId),
          ...prepared.shares.map((share) => share.participantId),
        ],
        excludeUserId,
      });
    })
    .catch((error: unknown) => {
      if (error instanceof SkipOccurrence) {
        return null;
      }
      throw error;
    });
}

/** Rolls the occurrence transaction back without failing the whole run. */
class SkipOccurrence extends Error {
  constructor() {
    super("skip-occurrence");
    this.name = "SkipOccurrence";
  }
}
