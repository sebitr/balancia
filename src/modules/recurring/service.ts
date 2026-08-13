import "server-only";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
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
import type { ExchangeRateSource } from "@/modules/currencies/conversion";
import { classifyRateSource } from "@/modules/currencies/rates";
import { prepareExpense } from "@/modules/expenses/service";
import {
  currencyCodeSchema,
  isoDateSchema,
  minorUnitsString,
  payerSchema,
  splitEntrySchema,
} from "@/modules/expenses/schemas";
import { SPLIT_METHODS, type SplitInput } from "@/modules/expenses/split";
import {
  firstOccurrence,
  nextOccurrence,
  occurrenceInstant,
  occurrencesUpTo,
  todayIn,
  type RecurrenceRule,
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
    description: z.string().trim().min(1, "Describe the expense").max(200),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
    category: z.string().trim().max(60).optional().or(z.literal("")),
    amount: minorUnitsString,
    currency: currencyCodeSchema,
    exchangeRate: z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/)
      .optional()
      .or(z.literal("")),
    payers: z.array(payerSchema).min(1, "Add at least one payer"),
    splitMethod: z.enum(SPLIT_METHODS),
    splitEntries: z.array(splitEntrySchema).min(1),
    frequency: z.enum(["weekly", "monthly", "yearly"]),
    interval: z.coerce.number().int().min(1).max(52).default(1),
    weekday: z.coerce.number().int().min(1).max(7).optional(),
    dayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
    monthOfYear: z.coerce.number().int().min(1).max(12).optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional().or(z.literal("")),
  })
  .refine((value) => BigInt(value.amount) > 0n, {
    path: ["amount"],
    message: "The amount must be greater than zero",
  })
  .refine(
    (value) => value.frequency !== "weekly" || value.weekday !== undefined,
    { path: ["weekday"], message: "Choose a day of the week" },
  )
  .refine(
    (value) => value.frequency === "weekly" || value.dayOfMonth !== undefined,
    { path: ["dayOfMonth"], message: "Choose a day of the month" },
  );

export type RecurringInput = z.infer<typeof recurringInputSchema>;

export interface RecurringSummary {
  readonly id: string;
  readonly description: string;
  readonly category: string | null;
  readonly amount: bigint;
  readonly currency: string;
  readonly frequency: "weekly" | "monthly" | "yearly";
  readonly interval: number;
  readonly weekday: number | null;
  readonly dayOfMonth: number | null;
  readonly monthOfYear: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly nextRunAt: Date | null;
  readonly lastRunAt: Date | null;
  readonly pausedAt: Date | null;
  readonly timezone: string;
  readonly generatedCount: number;
}

function ruleFrom(template: {
  frequency: "weekly" | "monthly" | "yearly";
  interval: number;
  weekday: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  timezone: string;
  startDate: string;
  endDate: string | null;
}): RecurrenceRule {
  return {
    frequency: template.frequency,
    interval: template.interval,
    weekday: template.weekday,
    dayOfMonth: template.dayOfMonth,
    monthOfYear: template.monthOfYear,
    timezone: template.timezone,
    startDate: template.startDate,
    endDate: template.endDate,
  };
}

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
    dayOfMonth: input.dayOfMonth ?? null,
    monthOfYear: input.monthOfYear ?? null,
    timezone,
    startDate: input.startDate,
    endDate: input.endDate || null,
  };
  const first = firstOccurrence(rule);

  // A template's rate is entered once and reused, so its provenance is decided
  // once too — against the day the template starts.
  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.startDate,
  });

  return db.transaction(async (tx) => {
    const [template] = await tx
      .insert(recurringExpenses)
      .values({
        groupId: access.groupId,
        description: input.description,
        notes: input.notes || null,
        category: input.category || null,
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
        dayOfMonth: input.dayOfMonth ?? null,
        monthOfYear: input.monthOfYear ?? null,
        timezone,
        startDate: input.startDate,
        endDate: input.endDate || null,
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
}

export async function setRecurringPaused(
  access: GroupAccess,
  templateId: string,
  paused: boolean,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "manageRecurring");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(recurringExpenses)
      .set({ pausedAt: paused ? new Date() : null, updatedAt: new Date() })
      .where(
        and(
          eq(recurringExpenses.id, templateId),
          eq(recurringExpenses.groupId, access.groupId),
          isNull(recurringExpenses.deletedAt),
        ),
      )
      .returning({ id: recurringExpenses.id });

    if (updated.length === 0) {
      throw new AuthorizationError(
        "That template is not part of this group.",
        "notInGroup",
      );
    }

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "recurring.updated",
      entityType: "recurring_expense",
      entityId: templateId,
      ...activityActorFrom(access),
      metadata: { paused },
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

export async function listRecurringExpenses(
  groupId: string,
  options: { db?: Database } = {},
): Promise<RecurringSummary[]> {
  const db = options.db ?? getDb();
  return db
    .select({
      id: recurringExpenses.id,
      description: recurringExpenses.description,
      category: recurringExpenses.category,
      amount: recurringExpenses.amount,
      currency: recurringExpenses.currency,
      frequency: recurringExpenses.frequency,
      interval: recurringExpenses.interval,
      weekday: recurringExpenses.weekday,
      dayOfMonth: recurringExpenses.dayOfMonth,
      monthOfYear: recurringExpenses.monthOfYear,
      startDate: recurringExpenses.startDate,
      endDate: recurringExpenses.endDate,
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
}

export interface GenerationReport {
  readonly templatesProcessed: number;
  readonly expensesCreated: number;
  readonly occurrencesSkipped: number;
}

/**
 * Generates every occurrence that is due.
 *
 * Called by the worker on a schedule, and directly by tests. Running it twice
 * over the same window is safe and produces no duplicates — that property is
 * the point of `recurring_occurrences`.
 */
export async function generateDueOccurrences(
  options: { db?: Database; now?: Date; groupId?: string } = {},
): Promise<GenerationReport> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const templates = await db
    .select({
      id: recurringExpenses.id,
      groupId: recurringExpenses.groupId,
      description: recurringExpenses.description,
      notes: recurringExpenses.notes,
      category: recurringExpenses.category,
      amount: recurringExpenses.amount,
      currency: recurringExpenses.currency,
      exchangeRate: recurringExpenses.exchangeRate,
      exchangeRateSource: recurringExpenses.exchangeRateSource,
      payers: recurringExpenses.payers,
      splitMethod: recurringExpenses.splitMethod,
      splitInput: recurringExpenses.splitInput,
      frequency: recurringExpenses.frequency,
      interval: recurringExpenses.interval,
      weekday: recurringExpenses.weekday,
      dayOfMonth: recurringExpenses.dayOfMonth,
      monthOfYear: recurringExpenses.monthOfYear,
      timezone: recurringExpenses.timezone,
      startDate: recurringExpenses.startDate,
      endDate: recurringExpenses.endDate,
      nextRunAt: recurringExpenses.nextRunAt,
      createdByParticipantId: recurringExpenses.createdByParticipantId,
      currencyMode: groups.currencyMode,
      baseCurrency: groups.baseCurrency,
      groupName: groups.name,
      archivedAt: groups.archivedAt,
    })
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

  for (const template of templates) {
    const rule = ruleFrom(template);
    const today = todayIn(template.timezone, now);

    const [lastOccurrence] = await db
      .select({ occurrenceDate: recurringOccurrences.occurrenceDate })
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.recurringExpenseId, template.id))
      .orderBy(sql`${recurringOccurrences.occurrenceDate} DESC`)
      .limit(1);

    const due = occurrencesUpTo(rule, today, {
      from: lastOccurrence?.occurrenceDate ?? null,
      // Cap catch-up so a template dormant for years cannot flood a group.
      maxOccurrences: 120,
    });

    for (const occurrenceDate of due) {
      const notificationIds = await generateSingleOccurrence(
        db,
        template,
        occurrenceDate,
      );
      if (notificationIds) {
        expensesCreated += 1;
        // Outside the occurrence transaction, which has already committed.
        await dispatchNotifications(notificationIds);
      } else {
        occurrencesSkipped += 1;
      }
    }

    // Advance the due marker even when nothing was generated, so the template
    // is not re-scanned on every tick.
    const lastGenerated = due.at(-1) ?? lastOccurrence?.occurrenceDate ?? null;
    const upcoming = lastGenerated
      ? nextOccurrence(rule, lastGenerated)
      : firstOccurrence(rule);

    await db
      .update(recurringExpenses)
      .set({
        nextRunAt: upcoming
          ? occurrenceInstant(upcoming, template.timezone)
          : null,
        lastRunAt: due.length > 0 ? now : undefined,
      })
      .where(eq(recurringExpenses.id, template.id));
  }

  return {
    templatesProcessed: templates.length,
    expensesCreated,
    occurrencesSkipped,
  };
}

/** The row shape `generateDueOccurrences` selects for each due template. */
interface TemplateRow {
  id: string;
  groupId: string;
  description: string;
  notes: string | null;
  category: string | null;
  amount: bigint;
  currency: string;
  exchangeRate: string | null;
  exchangeRateSource: ExchangeRateSource | null;
  payers: unknown;
  splitMethod: SplitInput["method"];
  splitInput: unknown;
  frequency: "weekly" | "monthly" | "yearly";
  interval: number;
  weekday: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  timezone: string;
  startDate: string;
  endDate: string | null;
  nextRunAt: Date | null;
  createdByParticipantId: string | null;
  currencyMode: "separate" | "converted";
  baseCurrency: string | null;
  groupName: string;
  archivedAt: Date | null;
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
): Promise<string[] | null> {
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
      // writing corrupt financial data.
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
        );

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
          exchangeRate: template.exchangeRate ?? undefined,
          payers,
          splitMethod: template.splitMethod,
          splitEntries,
        },
        // The occurrence inherits the template's frozen rate, so it inherits
        // where that rate came from too — this is not a fresh lookup.
        { rateSource: template.exchangeRateSource ?? "manual" },
      );

      const [expense] = await tx
        .insert(expenses)
        .values({
          groupId: template.groupId,
          description: template.description,
          notes: template.notes,
          category: template.category,
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
