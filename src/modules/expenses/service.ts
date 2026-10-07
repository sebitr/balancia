import "server-only";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb, onlyRow, type Database } from "@/lib/db/client";
import { keysetBefore, keysetTime, type ListCursor } from "@/lib/db/keyset";
import {
  attachments,
  entryClientKeys,
  expensePayers,
  expenseShares,
  expenses,
  participants,
} from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
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
import { changedFields, splitEntriesOf } from "./changes";
import type { EntryDirection } from "./direction";
import type { SpreadGroup } from "./spread";
import {
  convertAllocations,
  resolveSplit,
  validatePayerContributions,
  type SplitInput,
} from "./split";
import type { ExpenseInput } from "./schemas";
import {
  EditConflictError,
  entryVersion,
  nextVersion,
  versionIs,
} from "./edit-conflict";

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
  readonly subcategory: string | null;
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

/**
 * An expense as the transactions list reads it: the summary, plus the position
 * it occupies in that list.
 *
 * `cursorKey` is not part of `ExpenseSummary` because it is not a fact about
 * the expense — it is a fact about one ordering of one list, and a caller
 * fetching a single expense has no list to place it in.
 */
export interface ListedExpense extends ExpenseSummary {
  /** Creation instant, UTC, to the microsecond. See `@/lib/db/keyset`. */
  readonly cursorKey: string;
}

/**
 * Step 1 above: everyone the entry names, confirmed to be in the group and
 * held there until the transaction ends. Exported for recurring templates,
 * which name the same people and are held to the same rule when they are
 * saved.
 *
 * FOR SHARE is the half of the lock `removeParticipant` waits on: nobody named
 * here can be removed until this entry has committed, and a removal that got
 * there first makes this re-read the row and refuse. See the note there.
 *
 * `alreadyOnEntry` is for an edit. Somebody removed since the entry was written
 * is still on it, and correcting its description or its date is no reason to
 * drop them from a split they were part of — that would rewrite the history the
 * removal promised to keep. They may stay; they may not be added anywhere new.
 */
export async function assertParticipantsInGroup(
  tx: Database,
  groupId: string,
  participantIds: readonly string[],
  alreadyOnEntry: readonly string[] = [],
): Promise<Map<string, string>> {
  const unique = [...new Set(participantIds)];
  if (unique.length === 0) {
    throw new AllocationError("An expense needs at least one participant");
  }
  const rows = await tx
    .select({
      id: participants.id,
      displayName: participants.displayName,
      removedAt: participants.removedAt,
    })
    .from(participants)
    .where(
      and(eq(participants.groupId, groupId), inArray(participants.id, unique)),
    )
    .for("share");

  const allowed = rows.filter(
    (row) => row.removedAt === null || alreadyOnEntry.includes(row.id),
  );
  if (allowed.length !== unique.length) {
    throw new AuthorizationError(
      "One or more of those people are not part of this group.",
      "participantNotInGroup",
    );
  }
  return new Map(allowed.map((row) => [row.id, row.displayName]));
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
      convertedAmount: convertedPayers?.[index]?.amount ?? null,
    })),
    shares: split.allocations.map((allocation, index) => ({
      participantId: allocation.participantId,
      amount: allocation.amount,
      convertedAmount: convertedShares?.[index]?.amount ?? null,
    })),
    splitInput,
  };
}

/**
 * The expense a client key has already written, or null.
 *
 * Read outside any transaction: this is the fast path, taken before a replay
 * does any of the work of creating an expense. The slow path — two replays
 * arriving at once, both finding nothing here — is caught by the unique index
 * and re-read through this same function.
 */
export async function expenseForClientKey(
  db: Database,
  groupId: string,
  clientKey: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ entityId: entryClientKeys.entityId })
    .from(entryClientKeys)
    .where(
      and(
        eq(entryClientKeys.groupId, groupId),
        eq(entryClientKeys.clientKey, clientKey),
        eq(entryClientKeys.entityType, "expense"),
      ),
    )
    .limit(1);
  return existing?.entityId ?? null;
}

export interface WrittenExpense {
  readonly expenseId: string;
  /** For the caller to dispatch once the transaction has committed. */
  readonly notificationIds: string[];
  readonly converted: boolean;
  readonly shareCount: number;
}

/**
 * Writes one expense inside a transaction somebody else holds: the row, its
 * client key if it has one, its payers and shares, its receipts, its activity
 * event, the category it teaches and its notifications.
 *
 * Separate from `createExpense` so that a change of kind can write the expense
 * and remove the repayment it replaces in the same commit — see
 * `convertSettlementToExpense`. It dispatches nothing, for the reason given at
 * `writeSettlement`.
 */
export async function writeExpense(
  tx: Database,
  access: GroupAccess,
  input: ExpenseInput,
  options: { now?: Date; rateSource: ExchangeRateSource; clientKey?: string },
): Promise<WrittenExpense> {
  const referenced = [
    ...input.payers.map((payer) => payer.participantId),
    ...input.splitEntries.map((entry) => entry.participantId),
  ];
  await assertParticipantsInGroup(tx, access.groupId, referenced);

  const prepared = prepareExpense(access, input, {
    now: options.now,
    rateSource: options.rateSource,
  });

  const inserted = await tx
    .insert(expenses)
    .values({
      groupId: access.groupId,
      direction: input.direction ?? "out",
      description: input.description,
      notes: input.notes || null,
      category: input.category || null,
      subcategory: input.subcategory || null,
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
  const expense = onlyRow(inserted, "the expense insert");

  /*
   * Spend the key in the same transaction as the expense it names, so the
   * two can never disagree: either both are there or neither is. Written
   * here rather than after the commit because a crash in between would leave
   * an expense no replay could recognise, and the next flush would write a
   * second one.
   *
   * A concurrent replay that got past the fast path lands on the unique
   * index here and takes this whole transaction down with it — including the
   * duplicate expense above, which is the point. `createExpense` catches it.
   */
  if (options.clientKey) {
    await tx.insert(entryClientKeys).values({
      groupId: access.groupId,
      clientKey: options.clientKey,
      entityType: "expense",
      entityId: expense.id,
    });
  }

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
    await linkAttachments(tx, access.groupId, expense.id, input.attachmentIds);
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
      direction: input.direction ?? "out",
      splitMethod: input.splitMethod,
      payerCount: prepared.payers.length,
      shareCount: prepared.shares.length,
    },
  });

  // Whatever category was settled on teaches the classifier, in the same
  // transaction as the expense that taught it.
  await recordCategoryChoice(
    access,
    {
      merchant: input.description,
      category: input.category ?? null,
      subcategory: input.subcategory ?? null,
    },
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
}

/**
 * Records an expense.
 *
 * `clientKey` makes the call idempotent, and exists for the offline outbox: a
 * device that queued an entry with no signal replays it on reconnect, and may
 * replay it more than once — the answer came back over a connection that
 * dropped, the tab was closed mid-flush, two tabs woke together. Each of those
 * would otherwise write a second copy of somebody's money. With a key, the
 * second call returns the id the first one made and writes nothing.
 *
 * A key is spent for good once used, deletion included. A replay arriving after
 * the entry was deleted finds the key, hands back that id, and leaves the
 * deletion standing — which is the right answer: the person who removed it did
 * so knowing what it was, and a network retry is no reason to overrule them.
 */
export async function createExpense(
  access: GroupAccess,
  input: ExpenseInput,
  options: { db?: Database; now?: Date; clientKey?: string } = {},
): Promise<string> {
  requirePermission(access, "addExpense");
  const db = options.db ?? getDb();

  if (options.clientKey) {
    const already = await expenseForClientKey(
      db,
      access.groupId,
      options.clientKey,
    );
    if (already) return already;
  }

  // Outside the transaction: it is a cache read that only decides how the rate
  // is labelled, and it should not hold write locks open.
  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.expenseDate,
  });

  const write = () =>
    db.transaction((tx) =>
      writeExpense(tx, access, input, {
        now: options.now,
        rateSource,
        clientKey: options.clientKey,
      }),
    );

  /*
   * The backstop under the fast path above, for two replays of one entry that
   * were both in flight before either had written its key. One commits; the
   * other trips the unique index, rolls back the expense it was halfway
   * through, and lands here — where the committed id is now readable.
   *
   * Only ever consulted for a key we sent ourselves. Any other unique
   * violation from this transaction is a real fault and is rethrown.
   */
  let created: Awaited<ReturnType<typeof write>>;
  try {
    created = await write();
  } catch (error) {
    if (options.clientKey && isUniqueViolation(error)) {
      const already = await expenseForClientKey(
        db,
        access.groupId,
        options.clientKey,
      );
      if (already) return already;
    }
    throw error;
  }

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

/**
 * Replaces an expense with `input`, whole.
 *
 * `expectedVersion` is the version the edit was made from — what `getExpense`
 * handed out as `version`. With it, the write lands only if nobody has changed
 * the expense since, and an `EditConflictError` is thrown otherwise, with
 * nothing written. Without it the edit applies unconditionally, which is what
 * a caller that never read a version still gets. See `./edit-conflict`.
 *
 * Returns the version the expense has now.
 */
export async function updateExpense(
  access: GroupAccess,
  expenseId: string,
  input: ExpenseInput,
  options: { db?: Database; now?: Date; expectedVersion?: string } = {},
): Promise<string> {
  requirePermission(access, "editAnyExpense");
  const db = options.db ?? getDb();

  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.expenseDate,
  });

  const { notificationIds, version } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: expenses.id,
        description: expenses.description,
        amount: expenses.amount,
        currency: expenses.currency,
        direction: expenses.direction,
        expenseDate: expenses.expenseDate,
        category: expenses.category,
        subcategory: expenses.subcategory,
        notes: expenses.notes,
        splitMethod: expenses.splitMethod,
        splitInput: expenses.splitInput,
      })
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

    // What the edit is about to overwrite, read now because the allocations
    // are replaced wholesale below; the log says which parts of it moved.
    const previousPayers = await tx
      .select({
        participantId: expensePayers.participantId,
        amount: expensePayers.amount,
      })
      .from(expensePayers)
      .where(eq(expensePayers.expenseId, expenseId));
    // The split as it was asked for. A row that never kept it has only what
    // the split came to, which still says who was in it.
    const previousSplit =
      splitEntriesOf(existing.splitInput) ??
      (
        await tx
          .select({ participantId: expenseShares.participantId })
          .from(expenseShares)
          .where(eq(expenseShares.expenseId, expenseId))
      ).map((share) => ({ participantId: share.participantId }));

    // Captured before the allocations are replaced: someone dropped from the
    // split needs to hear that their share is gone just as much as someone
    // added to it. It is also who the edit may keep after they have left.
    const previousParticipants = await participantsOfExpense(tx, expenseId);

    const referenced = [
      ...input.payers.map((payer) => payer.participantId),
      ...input.splitEntries.map((entry) => entry.participantId),
    ];
    await assertParticipantsInGroup(
      tx,
      access.groupId,
      referenced,
      previousParticipants,
    );

    const prepared = prepareExpense(access, input, {
      now: options.now,
      rateSource,
    });

    const updated = await tx
      .update(expenses)
      .set({
        direction: input.direction ?? "out",
        description: input.description,
        notes: input.notes || null,
        category: input.category || null,
        subcategory: input.subcategory || null,
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
        updatedAt: nextVersion(expenses.updatedAt),
      })
      .where(
        and(
          eq(expenses.id, expenseId),
          eq(expenses.groupId, access.groupId),
          options.expectedVersion === undefined
            ? undefined
            : versionIs(expenses.updatedAt, options.expectedVersion),
        ),
      )
      .returning({ version: entryVersion(expenses.updatedAt) });

    /*
     * The row was there a moment ago — the read above found it — so the only
     * thing that can leave this empty is the version. A concurrent edit that
     * committed first is caught here too: this UPDATE waits on its row lock and
     * then re-checks the condition against the row that edit left behind.
     * Throwing rolls back everything this transaction has done so far.
     */
    const [written] = updated;
    if (!written) throw new EditConflictError();

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

    const changed = changedFields(
      {
        description: existing.description,
        amount: existing.amount,
        currency: existing.currency,
        direction: existing.direction,
        expenseDate: existing.expenseDate,
        category: existing.category,
        subcategory: existing.subcategory,
        notes: existing.notes,
        splitMethod: existing.splitMethod,
        splitEntries: previousSplit,
        payers: previousPayers,
      },
      {
        description: input.description,
        amount: prepared.amount,
        currency: prepared.currency,
        direction: input.direction ?? "out",
        expenseDate: input.expenseDate,
        category: input.category || null,
        subcategory: input.subcategory || null,
        notes: input.notes || null,
        splitMethod: input.splitMethod,
        splitEntries: prepared.splitInput.entries,
        payers: prepared.payers,
      },
    );

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
        direction: input.direction ?? "out",
        splitMethod: input.splitMethod,
        // Which parts of the entry this edit moved, and what the two figures
        // a line can quote were before it. Never the notes themselves.
        changed,
        before: {
          description: existing.description,
          amount: existing.amount.toString(),
          currency: existing.currency,
        },
      },
    });

    await recordCategoryChoice(
      access,
      {
        merchant: input.description,
        category: input.category ?? null,
        subcategory: input.subcategory ?? null,
      },
      { db: tx },
    );

    const notificationIds = await recordExpenseNotification(tx, access, {
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
    return { notificationIds, version: written.version };
  });

  await dispatchNotifications(notificationIds);

  // Only which method the edit ended on: an edit that moved an amount, a date
  // or a payer is indistinguishable here from one that fixed a typo, and that
  // is the intended resolution.
  await telemetry.expenseUpdated({ splitMethod: input.splitMethod });

  return version;
}

/**
 * Soft-deletes one expense inside a transaction somebody else holds, and hands
 * back the notification ids for them to dispatch after their commit.
 * `writeExpense`'s counterpart; the note at `writeSettlement` says why these
 * are apart.
 *
 * `replacedBy` is `deleteExpense`'s, and the change of kind in `convert.ts`
 * is the caller that sets it.
 */
export async function removeExpense(
  tx: Database,
  access: GroupAccess,
  expenseId: string,
  options: { replacedBy?: string } = {},
): Promise<string[]> {
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
      direction: expenses.direction,
    });

  const [deletedExpense] = deleted;
  if (!deletedExpense) {
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
      description: deletedExpense.description,
      amount: deletedExpense.amount.toString(),
      currency: deletedExpense.currency,
      direction: deletedExpense.direction,
      ...(options.replacedBy ? { replacedBy: options.replacedBy } : {}),
    },
  });

  // The allocations survive a soft delete, so they still say who this
  // expense concerned.
  return recordExpenseNotification(tx, access, {
    type: "expense.deleted",
    expenseId,
    description: deletedExpense.description,
    amount: deletedExpense.amount,
    currency: deletedExpense.currency,
    participantIds: await participantsOfExpense(tx, expenseId),
  });
}

export async function deleteExpense(
  access: GroupAccess,
  expenseId: string,
  options: {
    db?: Database;
    /**
     * The repayment written in this expense's place, when the deletion is
     * half of a change of type. Recorded on the event so the Activity screen
     * does not offer to put back something that was replaced rather than lost.
     */
    replacedBy?: string;
  } = {},
): Promise<void> {
  requirePermission(access, "editAnyExpense");
  const db = options.db ?? getDb();

  const notificationIds = await db.transaction((tx) =>
    removeExpense(tx, access, expenseId, { replacedBy: options.replacedBy }),
  );

  await dispatchNotifications(notificationIds);
}

/**
 * Puts a deleted expense back — the Undo behind the deletion toast.
 *
 * Deletion only stamps `deleted_at`; the payers, the shares and the
 * attachments are all left exactly where they were, so clearing that stamp is
 * the entire restoration and the balances come back to the cent.
 *
 * The guard is `deleted_at IS NOT NULL` rather than the delete's mirror image.
 * It means an expense that is already live cannot be "restored", so a second
 * press of Undo — or a request replayed by a flaky connection — changes
 * nothing and writes no second event.
 *
 * What it cannot take back is the notification the deletion already sent: a
 * push is gone the moment it leaves. Restoring deliberately does not send one
 * of its own either, because two contradictory alerts seconds apart tell the
 * reader less than one did. The activity log is where both are recorded, in
 * the order they happened.
 */
export async function restoreExpense(
  access: GroupAccess,
  expenseId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "editAnyExpense");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const restored = await tx
      .update(expenses)
      .set({ deletedAt: null })
      .where(
        and(
          eq(expenses.id, expenseId),
          eq(expenses.groupId, access.groupId),
          isNotNull(expenses.deletedAt),
        ),
      )
      .returning({
        description: expenses.description,
        amount: expenses.amount,
        currency: expenses.currency,
        direction: expenses.direction,
      });

    const [restoredExpense] = restored;
    if (!restoredExpense) {
      throw new AuthorizationError(
        "That expense is not part of this group.",
        "notInGroup",
      );
    }

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "expense.restored",
      entityType: "expense",
      entityId: expenseId,
      ...activityActorFrom(access),
      metadata: {
        description: restoredExpense.description,
        amount: restoredExpense.amount.toString(),
        currency: restoredExpense.currency,
        direction: restoredExpense.direction,
      },
    });
  });
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
        // A fresh upload, or one this expense already holds. A receipt on
        // somebody else's expense is not up for grabs: the ids are whatever
        // the form sent, and without this a submitted id would lift the
        // photo off the entry it documents and onto this one.
        or(isNull(attachments.expenseId), eq(attachments.expenseId, expenseId)),
      ),
    );
}

/**
 * Expenses for a group, newest first, with payers and shares resolved.
 *
 * Two ways to walk the list. `before` is the one the transactions screen uses:
 * hand back the cursor of the last row you were given and the next call
 * continues from exactly there, at constant cost and with no risk of a row
 * being shown twice or missed. `offset` remains for the export, which reads
 * the whole list in one pass and has no reader scrolling underneath it.
 *
 * `where` and `orderBy` are the transactions list's filters and its other two
 * orders, built by `transactions.ts`. `where` narrows on top of the group and
 * deletion checks, never instead of them; `orderBy` replaces the newest-first
 * order, and whoever passes it passes the keyset condition that goes with it.
 */
export async function listExpenses(
  groupId: string,
  options: {
    db?: Database;
    limit?: number;
    offset?: number;
    before?: ListCursor | null;
    where?: SQL;
    orderBy?: readonly SQL[];
  } = {},
): Promise<ListedExpense[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      cursorKey: keysetTime(expenses.createdAt),
      id: expenses.id,
      direction: expenses.direction,
      description: expenses.description,
      notes: expenses.notes,
      category: expenses.category,
      subcategory: expenses.subcategory,
      amount: expenses.amount,
      currency: expenses.currency,
      convertedAmount: expenses.convertedAmount,
      convertedCurrency: expenses.convertedCurrency,
      exchangeRate: expenses.exchangeRate,
      splitMethod: expenses.splitMethod,
      expenseDate: expenses.expenseDate,
      createdAt: expenses.createdAt,
      recurringExpenseId: expenses.recurringExpenseId,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
        options.before
          ? keysetBefore(
              {
                date: expenses.expenseDate,
                time: expenses.createdAt,
                id: expenses.id,
              },
              options.before,
            )
          : undefined,
        options.where,
      ),
    )
    // `id` last, and never left out: an import files hundreds of rows under
    // one transaction clock, and without it their order is the database's
    // choice — a different one per query.
    .orderBy(
      ...(options.orderBy ?? [
        desc(expenses.expenseDate),
        desc(expenses.createdAt),
        desc(expenses.id),
      ]),
    )
    .limit(options.limit ?? 100)
    .offset(options.offset ?? 0);

  if (rows.length === 0) return [];

  const expenseIds = rows.map((row) => row.id);
  /*
   * The receipts are counted in a query of their own rather than a subquery in
   * the select list above, which is where they used to be counted. Drizzle
   * writes a single-table select list with bare column names, so that subquery
   * read `WHERE "expense_id" = "id"` — the attachment's own id, not the
   * expense's — and every row of every list said it had no receipt. The
   * list's `With a receipt` filter never found anything.
   */
  const [payerRows, shareRows, receiptRows] = await Promise.all([
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
    db
      .select({ expenseId: attachments.expenseId, count: count() })
      .from(attachments)
      .where(
        and(
          inArray(attachments.expenseId, expenseIds),
          isNull(attachments.deletedAt),
        ),
      )
      .groupBy(attachments.expenseId),
  ]);

  const payersByExpense = groupBy(payerRows, (row) => row.expenseId);
  const sharesByExpense = groupBy(shareRows, (row) => row.expenseId);
  const receiptsByExpense = new Map(
    receiptRows.map((row) => [row.expenseId, row.count]),
  );

  return rows.map((row) => ({
    ...row,
    attachmentCount: receiptsByExpense.get(row.id) ?? 0,
    payers: payersByExpense.get(row.id) ?? [],
    shares: sharesByExpense.get(row.id) ?? [],
  }));
}

/**
 * Every expense in the group, summed into what the category spread reads.
 *
 * Over the whole group, and deliberately so. The spine is a picture of
 * *proportions*, and a proportion measured over the newest page only is not a
 * smaller truth, it is a different and wrong one — it would also redraw itself
 * under the reader's thumb as paging brought more rows in.
 *
 * But not a row per expense. This used to send every expense the group had
 * ever recorded to the page on every visit, to be added up there; now the
 * database adds them up, and what comes back is one row per combination of
 * direction, category, subcategory and currency — tens of rows, however many
 * years of history sit behind them.
 *
 * The rule for which amount counts, and in which currency, still runs in
 * `categoryTotals`, on these sums, because it is the one the balances use and
 * there must go on being exactly one copy of it. Summing first changes
 * nothing it decides: every row it reads here shares its currency and its
 * converted currency, so `moneyForGroup` picks the same field, and files it
 * under the same currency, for the sum as for each part. (Grouping by the
 * converted currency is also grouping by whether there is a converted amount
 * at all: `expenses_conversion_complete` sets the two together or neither.)
 */
export async function listSpreadEntries(
  groupId: string,
  options: { db?: Database } = {},
): Promise<SpreadGroup[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      direction: expenses.direction,
      category: expenses.category,
      subcategory: expenses.subcategory,
      currency: expenses.currency,
      convertedCurrency: expenses.convertedCurrency,
      // As text: `sum(bigint)` is a numeric, and money never passes through a
      // JavaScript number on its way to being a bigint again.
      amount: sql<string>`sum(${expenses.amount})::text`,
      convertedAmount: sql<
        string | null
      >`sum(${expenses.convertedAmount})::text`,
      count: count(),
    })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .groupBy(
      expenses.direction,
      expenses.category,
      expenses.subcategory,
      expenses.currency,
      expenses.convertedCurrency,
    );

  return rows.map((row) => ({
    ...row,
    amount: BigInt(row.amount),
    convertedAmount:
      row.convertedAmount === null ? null : BigInt(row.convertedAmount),
  }));
}

/**
 * A single expense, scoped to its group. Returns null if it is not there.
 *
 * `version` is what an edit of it hands back to `updateExpense` as
 * `expectedVersion`, so the edit is refused if somebody else got there first.
 */
export async function getExpense(
  groupId: string,
  expenseId: string,
  options: { db?: Database } = {},
): Promise<
  (ExpenseSummary & { splitInput: SplitInput | null; version: string }) | null
> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({
      version: entryVersion(expenses.updatedAt),
      id: expenses.id,
      direction: expenses.direction,
      description: expenses.description,
      notes: expenses.notes,
      category: expenses.category,
      subcategory: expenses.subcategory,
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

/**
 * The reader's own most recent entry, in their own words.
 *
 * Written for the notation preview in settings, which needs one real line of
 * this account's money to show the formats against: a made-up 1 234,56 proves
 * nothing about how *your* amounts will read, and a preview nobody recognises
 * is a preview nobody trusts.
 *
 * "Their own" means an entry that lands on their balance — one they hold a
 * share of. An expense in a group they belong to but were left out of is not
 * theirs, and would be a stranger's dinner shown as an example of their money.
 *
 * Ordered by the date the entry is *for*, then by when it was written, which
 * is the same order the group's own timeline uses: an expense back-dated to
 * last month is not the latest thing that happened to this account.
 *
 * Null where there is nothing yet, which is every new account, and the caller
 * draws the screen without a preview rather than with an invented one.
 */
export interface LatestEntry {
  readonly description: string;
  readonly direction: EntryDirection;
  /** Minor units, as text — never a JS number. */
  readonly amount: string;
  readonly currency: string;
  readonly expenseDate: string;
}

export async function getLatestEntryForUser(
  userId: string,
  options: { db?: Database } = {},
): Promise<LatestEntry | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({
      description: expenses.description,
      direction: expenses.direction,
      amount: expenses.amount,
      currency: expenses.currency,
      expenseDate: expenses.expenseDate,
    })
    .from(expenses)
    .innerJoin(expenseShares, eq(expenseShares.expenseId, expenses.id))
    .innerJoin(participants, eq(participants.id, expenseShares.participantId))
    .where(and(eq(participants.userId, userId), isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
    .limit(1);

  // Minor units leave here as text, like every other amount that crosses into
  // a Client Component: a bigint cannot be serialised, and a JS number would
  // lose the cents this screen exists to show.
  return row ? { ...row, amount: row.amount.toString() } : null;
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
