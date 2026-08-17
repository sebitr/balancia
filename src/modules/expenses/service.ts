import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import {
  attachments,
  expensePayers,
  expenseShares,
  expenses,
  participants,
} from "@/lib/db/schema";
import {
  AuthorizationError,
  requirePermission,
  type GroupAccess,
} from "@/lib/security/authorization";
import { activityActorFrom, recordActivity } from "@/modules/activity/service";
import { dispatchNotifications } from "@/modules/notifications/service";
import {
  participantsOfExpense,
  recordExpenseNotification,
} from "@/modules/notifications/events";
import { recordCategoryChoice } from "@/modules/categorization/service";
import { telemetry } from "@/lib/telemetry";
import {
  resolveConversion,
  type ExchangeRateSource,
} from "@/modules/currencies/conversion";
import { classifyRateSource } from "@/modules/currencies/rates";
import { money } from "@/modules/currencies/money";
import { AllocationError } from "./allocation";
import type { EntryDirection } from "./direction";
import {
  convertAllocations,
  resolveSplit,
  validatePayerContributions,
  type SplitInput,
} from "./split";
import type { ExpenseInput } from "./schemas";

/**
 * Expense service.
 *
 * Responsibilities, in order, for every write:
 *  1. Verify every referenced participant really belongs to the authorized group.
 *  2. Resolve currency conversion (freezing a rate if the group converts).
 *  3. Normalize the split into integer allocations that sum to the total.
 *  4. Write expense, payers and shares, plus the activity event, in ONE
 *     transaction.
 *
 * Nothing here trusts a participant ID from the request: step 1 is what stops
 * a caller from attaching a stranger to an expense.
 */

export interface ExpenseSummary {
  readonly id: string;
  readonly direction: EntryDirection;
  readonly description: string;
  readonly notes: string | null;
  readonly category: string | null;
  readonly amount: bigint;
  readonly currency: string;
  readonly convertedAmount: bigint | null;
  readonly convertedCurrency: string | null;
  readonly exchangeRate: string | null;
  readonly splitMethod: "equal" | "exact" | "percentage" | "shares";
  readonly expenseDate: string;
  readonly createdAt: Date;
  readonly payers: readonly {
    participantId: string;
    displayName: string;
    amount: bigint;
    convertedAmount: bigint | null;
  }[];
  readonly shares: readonly {
    participantId: string;
    displayName: string;
    amount: bigint;
    convertedAmount: bigint | null;
  }[];
  readonly attachmentCount: number;
  readonly recurringExpenseId: string | null;
}

async function assertParticipantsInGroup(
  tx: Database,
  groupId: string,
  participantIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(participantIds)];
  if (unique.length === 0) {
    throw new AllocationError("An expense needs at least one participant");
  }
  const rows = await tx
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(
      and(
        eq(participants.groupId, groupId),
        inArray(participants.id, unique),
        isNull(participants.removedAt),
      ),
    );

  if (rows.length !== unique.length) {
    throw new AuthorizationError(
      "One or more of those people are not part of this group.",
    );
  }
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

interface PreparedExpense {
  readonly amount: bigint;
  readonly currency: string;
  readonly convertedAmount: bigint | null;
  readonly convertedCurrency: string | null;
  readonly exchangeRate: string | null;
  readonly exchangeRateSource: ExchangeRateSource | null;
  readonly exchangeRateAt: Date | null;
  readonly payers: {
    participantId: string;
    amount: bigint;
    convertedAmount: bigint | null;
  }[];
  readonly shares: {
    participantId: string;
    amount: bigint;
    convertedAmount: bigint | null;
  }[];
  readonly splitInput: SplitInput;
}

/**
 * Turns validated input into the exact rows to persist. Pure apart from the
 * participant check the caller has already done — kept separate so the
 * recurring-expense generator can reuse it.
 */
export function prepareExpense(
  access: Pick<GroupAccess, "group">,
  input: {
    amount: string;
    currency: string;
    exchangeRate?: string;
    payers: readonly { participantId: string; amount: string }[];
    splitMethod: SplitInput["method"];
    splitEntries: readonly { participantId: string; value?: string }[];
  },
  options: { rateSource?: ExchangeRateSource; now?: Date } = {},
): PreparedExpense {
  const total = BigInt(input.amount);
  const originalAmount = money(total, input.currency);

  const conversion = resolveConversion({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    amount: originalAmount,
    rate: input.exchangeRate ? input.exchangeRate : undefined,
    source: options.rateSource ?? "manual",
    capturedAt: options.now,
  });

  const payerContributions = input.payers.map((payer) => ({
    participantId: payer.participantId,
    amount: BigInt(payer.amount),
  }));
  validatePayerContributions(total, payerContributions);

  const splitInput: SplitInput = {
    method: input.splitMethod,
    entries: input.splitEntries.map((entry) => ({
      participantId: entry.participantId,
      value: entry.value,
    })),
  };
  const split = resolveSplit(total, splitInput);

  const converts = conversion.frozenRate !== null;
  const convertedTotal = converts ? conversion.effective.amount : null;

  // Convert payer contributions and shares proportionally to the *converted
  // total*, so both sides still balance exactly after conversion.
  const convertedPayers = converts
    ? convertAllocations(
        payerContributions.map((payer) => ({
          participantId: payer.participantId,
          amount: payer.amount,
        })),
        convertedTotal!,
        total,
      )
    : null;
  const convertedShares = converts
    ? convertAllocations([...split.allocations], convertedTotal!, total)
    : null;

  return {
    amount: total,
    currency: input.currency,
    convertedAmount: convertedTotal,
    convertedCurrency: converts ? conversion.effective.currency : null,
    exchangeRate: conversion.frozenRate?.rate ?? null,
    exchangeRateSource: conversion.frozenRate?.source ?? null,
    exchangeRateAt: conversion.frozenRate?.capturedAt ?? null,
    payers: payerContributions.map((payer, index) => ({
      participantId: payer.participantId,
      amount: payer.amount,
      convertedAmount: convertedPayers?.[index].amount ?? null,
    })),
    shares: split.allocations.map((allocation, index) => ({
      participantId: allocation.participantId,
      amount: allocation.amount,
      convertedAmount: convertedShares?.[index].amount ?? null,
    })),
    splitInput,
  };
}

export async function createExpense(
  access: GroupAccess,
  input: ExpenseInput,
  options: { db?: Database; now?: Date } = {},
): Promise<string> {
  requirePermission(access, "addExpense");
  const db = options.db ?? getDb();

  // Outside the transaction: it is a cache read that only decides how the rate
  // is labelled, and it should not hold write locks open.
  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.expenseDate,
  });

  const created = await db.transaction(async (tx) => {
    const referenced = [
      ...input.payers.map((payer) => payer.participantId),
      ...input.splitEntries.map((entry) => entry.participantId),
    ];
    await assertParticipantsInGroup(tx, access.groupId, referenced);

    const prepared = prepareExpense(access, input, {
      now: options.now,
      rateSource,
    });

    const [expense] = await tx
      .insert(expenses)
      .values({
        groupId: access.groupId,
        direction: input.direction ?? "out",
        description: input.description,
        notes: input.notes || null,
        category: input.category || null,
        amount: prepared.amount,
        currency: prepared.currency,
        convertedAmount: prepared.convertedAmount,
        convertedCurrency: prepared.convertedCurrency,
        exchangeRate: prepared.exchangeRate,
        exchangeRateSource: prepared.exchangeRateSource,
        exchangeRateAt: prepared.exchangeRateAt,
        splitMethod: input.splitMethod,
        splitInput: prepared.splitInput,
        expenseDate: input.expenseDate,
        createdByActorType: access.actor.kind,
        createdByParticipantId: access.participantId,
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

    if (input.attachmentIds?.length) {
      await linkAttachments(
        tx,
        access.groupId,
        expense.id,
        input.attachmentIds,
      );
    }

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "expense.created",
      entityType: "expense",
      entityId: expense.id,
      ...activityActorFrom(access),
      metadata: {
        description: input.description,
        amount: prepared.amount.toString(),
        currency: prepared.currency,
        splitMethod: input.splitMethod,
        payerCount: prepared.payers.length,
        shareCount: prepared.shares.length,
      },
    });

    // Whatever category was settled on teaches the classifier, in the same
    // transaction as the expense that taught it.
    await recordCategoryChoice(
      access,
      { merchant: input.description, category: input.category ?? null },
      { db: tx },
    );

    const notificationIds = await recordExpenseNotification(tx, access, {
      type: "expense.created",
      expenseId: expense.id,
      description: input.description,
      amount: prepared.amount,
      currency: prepared.currency,
      participantIds: [
        ...prepared.payers.map((payer) => payer.participantId),
        ...prepared.shares.map((share) => share.participantId),
      ],
    });

    return {
      expenseId: expense.id,
      notificationIds,
      // Carried out of the transaction for telemetry: two numbers and a
      // boolean, decided here where the prepared expense is in scope.
      converted: prepared.exchangeRate !== null,
      shareCount: prepared.shares.length,
    };
  });

  const { expenseId, notificationIds } = created;

  // After the commit: pushing is a call to a third-party push service, and it
  // must not run inside a transaction that could still roll back.
  await dispatchNotifications(notificationIds);

  // Also after the commit, and for a stronger version of the same reason: an
  // expense must never fail to save because a counter could not be written.
  // Four coarse facts about *how* the expense was entered — the description,
  // the amount, the currency and everyone's name stay here.
  await telemetry.expenseCreated({
    splitMethod: input.splitMethod,
    direction: input.direction ?? "out",
    multiCurrency: created.converted,
    hasReceipt: (input.attachmentIds?.length ?? 0) > 0,
    participantCount: created.shareCount,
  });

  return expenseId;
}

export async function updateExpense(
  access: GroupAccess,
  expenseId: string,
  input: ExpenseInput,
  options: { db?: Database; now?: Date } = {},
): Promise<void> {
  requirePermission(access, "editAnyExpense");
  const db = options.db ?? getDb();

  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.expenseDate,
  });

  const notificationIds = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: expenses.id, description: expenses.description })
      .from(expenses)
      .where(
        and(
          eq(expenses.id, expenseId),
          eq(expenses.groupId, access.groupId),
          isNull(expenses.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new AuthorizationError(
        "That expense is not part of this group.",
        "notInGroup",
      );
    }

    const referenced = [
      ...input.payers.map((payer) => payer.participantId),
      ...input.splitEntries.map((entry) => entry.participantId),
    ];
    await assertParticipantsInGroup(tx, access.groupId, referenced);

    const prepared = prepareExpense(access, input, {
      now: options.now,
      rateSource,
    });

    // Captured before the allocations are replaced: someone dropped from the
    // split needs to hear that their share is gone just as much as someone
    // added to it.
    const previousParticipants = await participantsOfExpense(tx, expenseId);

    await tx
      .update(expenses)
      .set({
        direction: input.direction ?? "out",
        description: input.description,
        notes: input.notes || null,
        category: input.category || null,
        amount: prepared.amount,
        currency: prepared.currency,
        convertedAmount: prepared.convertedAmount,
        convertedCurrency: prepared.convertedCurrency,
        exchangeRate: prepared.exchangeRate,
        exchangeRateSource: prepared.exchangeRateSource,
        exchangeRateAt: prepared.exchangeRateAt,
        splitMethod: input.splitMethod,
        splitInput: prepared.splitInput,
        expenseDate: input.expenseDate,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, expenseId));

    // Replace allocations wholesale: a partial update could leave a stale row
    // whose share no longer belongs to the new split.
    await tx
      .delete(expensePayers)
      .where(eq(expensePayers.expenseId, expenseId));
    await tx
      .delete(expenseShares)
      .where(eq(expenseShares.expenseId, expenseId));

    await tx.insert(expensePayers).values(
      prepared.payers.map((payer) => ({
        expenseId,
        participantId: payer.participantId,
        amount: payer.amount,
        convertedAmount: payer.convertedAmount,
      })),
    );
    await tx.insert(expenseShares).values(
      prepared.shares.map((share) => ({
        expenseId,
        participantId: share.participantId,
        amount: share.amount,
        convertedAmount: share.convertedAmount,
      })),
    );

    if (input.attachmentIds) {
      await linkAttachments(tx, access.groupId, expenseId, input.attachmentIds);
    }

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "expense.updated",
      entityType: "expense",
      entityId: expenseId,
      ...activityActorFrom(access),
      metadata: {
        description: input.description,
        amount: prepared.amount.toString(),
        currency: prepared.currency,
        splitMethod: input.splitMethod,
      },
    });

    await recordCategoryChoice(
      access,
      { merchant: input.description, category: input.category ?? null },
      { db: tx },
    );

    return recordExpenseNotification(tx, access, {
      type: "expense.updated",
      expenseId,
      description: input.description,
      amount: prepared.amount,
      currency: prepared.currency,
      participantIds: [
        ...previousParticipants,
        ...prepared.payers.map((payer) => payer.participantId),
        ...prepared.shares.map((share) => share.participantId),
      ],
    });
  });

  await dispatchNotifications(notificationIds);

  // Only which method the edit ended on: an edit that moved an amount, a date
  // or a payer is indistinguishable here from one that fixed a typo, and that
  // is the intended resolution.
  await telemetry.expenseUpdated({ splitMethod: input.splitMethod });
}

export async function deleteExpense(
  access: GroupAccess,
  expenseId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "editAnyExpense");
  const db = options.db ?? getDb();

  const notificationIds = await db.transaction(async (tx) => {
    const deleted = await tx
      .update(expenses)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(expenses.id, expenseId),
          eq(expenses.groupId, access.groupId),
          isNull(expenses.deletedAt),
        ),
      )
      .returning({
        id: expenses.id,
        description: expenses.description,
        amount: expenses.amount,
        currency: expenses.currency,
      });

    if (deleted.length === 0) {
      throw new AuthorizationError(
        "That expense is not part of this group.",
        "notInGroup",
      );
    }

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "expense.deleted",
      entityType: "expense",
      entityId: expenseId,
      ...activityActorFrom(access),
      metadata: {
        description: deleted[0].description,
        amount: deleted[0].amount.toString(),
        currency: deleted[0].currency,
      },
    });

    // The allocations survive a soft delete, so they still say who this
    // expense concerned.
    return recordExpenseNotification(tx, access, {
      type: "expense.deleted",
      expenseId,
      description: deleted[0].description,
      amount: deleted[0].amount,
      currency: deleted[0].currency,
      participantIds: await participantsOfExpense(tx, expenseId),
    });
  });

  await dispatchNotifications(notificationIds);
}

async function linkAttachments(
  tx: Database,
  groupId: string,
  expenseId: string,
  attachmentIds: readonly string[],
): Promise<void> {
  if (attachmentIds.length === 0) return;
  await tx
    .update(attachments)
    .set({ expenseId })
    .where(
      and(
        inArray(attachments.id, [...attachmentIds]),
        eq(attachments.groupId, groupId),
        isNull(attachments.deletedAt),
      ),
    );
}

/** Expenses for a group, newest first, with payers and shares resolved. */
export async function listExpenses(
  groupId: string,
  options: { db?: Database; limit?: number; offset?: number } = {},
): Promise<ExpenseSummary[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      id: expenses.id,
      direction: expenses.direction,
      description: expenses.description,
      notes: expenses.notes,
      category: expenses.category,
      amount: expenses.amount,
      currency: expenses.currency,
      convertedAmount: expenses.convertedAmount,
      convertedCurrency: expenses.convertedCurrency,
      exchangeRate: expenses.exchangeRate,
      splitMethod: expenses.splitMethod,
      expenseDate: expenses.expenseDate,
      createdAt: expenses.createdAt,
      recurringExpenseId: expenses.recurringExpenseId,
      attachmentCount: sql<number>`(
        SELECT count(*)::int FROM ${attachments}
        WHERE ${attachments.expenseId} = ${expenses.id}
          AND ${attachments.deletedAt} IS NULL
      )`,
    })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
    .limit(options.limit ?? 100)
    .offset(options.offset ?? 0);

  if (rows.length === 0) return [];

  const expenseIds = rows.map((row) => row.id);
  const [payerRows, shareRows] = await Promise.all([
    db
      .select({
        expenseId: expensePayers.expenseId,
        participantId: expensePayers.participantId,
        amount: expensePayers.amount,
        convertedAmount: expensePayers.convertedAmount,
        displayName: participants.displayName,
      })
      .from(expensePayers)
      .innerJoin(participants, eq(participants.id, expensePayers.participantId))
      .where(inArray(expensePayers.expenseId, expenseIds)),
    db
      .select({
        expenseId: expenseShares.expenseId,
        participantId: expenseShares.participantId,
        amount: expenseShares.amount,
        convertedAmount: expenseShares.convertedAmount,
        displayName: participants.displayName,
      })
      .from(expenseShares)
      .innerJoin(participants, eq(participants.id, expenseShares.participantId))
      .where(inArray(expenseShares.expenseId, expenseIds)),
  ]);

  const payersByExpense = groupBy(payerRows, (row) => row.expenseId);
  const sharesByExpense = groupBy(shareRows, (row) => row.expenseId);

  return rows.map((row) => ({
    ...row,
    payers: payersByExpense.get(row.id) ?? [],
    shares: sharesByExpense.get(row.id) ?? [],
  }));
}

/** A single expense, scoped to its group. Returns null if it is not there. */
export async function getExpense(
  groupId: string,
  expenseId: string,
  options: { db?: Database } = {},
): Promise<(ExpenseSummary & { splitInput: SplitInput | null }) | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({
      id: expenses.id,
      direction: expenses.direction,
      description: expenses.description,
      notes: expenses.notes,
      category: expenses.category,
      amount: expenses.amount,
      currency: expenses.currency,
      convertedAmount: expenses.convertedAmount,
      convertedCurrency: expenses.convertedCurrency,
      exchangeRate: expenses.exchangeRate,
      splitMethod: expenses.splitMethod,
      splitInput: expenses.splitInput,
      expenseDate: expenses.expenseDate,
      createdAt: expenses.createdAt,
      recurringExpenseId: expenses.recurringExpenseId,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.id, expenseId),
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  const [payerRows, shareRows, attachmentRows] = await Promise.all([
    db
      .select({
        participantId: expensePayers.participantId,
        amount: expensePayers.amount,
        convertedAmount: expensePayers.convertedAmount,
        displayName: participants.displayName,
      })
      .from(expensePayers)
      .innerJoin(participants, eq(participants.id, expensePayers.participantId))
      .where(eq(expensePayers.expenseId, expenseId)),
    db
      .select({
        participantId: expenseShares.participantId,
        amount: expenseShares.amount,
        convertedAmount: expenseShares.convertedAmount,
        displayName: participants.displayName,
      })
      .from(expenseShares)
      .innerJoin(participants, eq(participants.id, expenseShares.participantId))
      .where(eq(expenseShares.expenseId, expenseId)),
    db
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        and(
          eq(attachments.expenseId, expenseId),
          isNull(attachments.deletedAt),
        ),
      ),
  ]);

  return {
    ...row,
    splitInput: (row.splitInput as SplitInput | null) ?? null,
    payers: payerRows,
    shares: shareRows,
    attachmentCount: attachmentRows.length,
  };
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const item of items) {
    const bucket = result.get(key(item));
    if (bucket) {
      bucket.push(item);
    } else {
      result.set(key(item), [item]);
    }
  }
  return result;
}
