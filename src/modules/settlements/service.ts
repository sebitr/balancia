import "server-only";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
} from "drizzle-orm";
import { getDb, onlyRow, type Database } from "@/lib/db/client";
import { keysetBefore, keysetTime, type ListCursor } from "@/lib/db/keyset";
import { entryClientKeys, participants, settlements } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  AuthorizationError,
  requirePermission,
  type GroupAccess,
} from "@/lib/security/authorization";
import { activityActorFrom, recordActivity } from "@/modules/activity/service";
import { dispatchNotifications } from "@/modules/notifications/service";
import { recordSettlementNotification } from "@/modules/notifications/events";
import {
  resolveConversion,
  type ExchangeRateSource,
} from "@/modules/currencies/conversion";
import { money } from "@/modules/currencies/money";
import { classifyRateSource } from "@/modules/currencies/rates";
import { telemetry } from "@/lib/telemetry";
import type { SettlementInput } from "@/modules/expenses/schemas";

/**
 * Settlement service.
 *
 * A settlement is a repayment, not a purchase: it moves balances but never
 * appears in group spending totals. It is modelled separately from expenses so
 * that distinction cannot blur.
 */

export interface SettlementSummary {
  readonly id: string;
  readonly fromParticipantId: string;
  readonly fromName: string;
  readonly toParticipantId: string;
  readonly toName: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly convertedAmount: bigint | null;
  readonly convertedCurrency: string | null;
  readonly exchangeRate: string | null;
  readonly settledOn: string;
  readonly notes: string | null;
  readonly createdAt: Date;
}

/** A settlement as the transactions list reads it. See `ListedExpense`. */
export interface ListedSettlement extends SettlementSummary {
  /** Creation instant, UTC, to the microsecond. See `@/lib/db/keyset`. */
  readonly cursorKey: string;
}

async function assertParticipants(
  tx: Database,
  groupId: string,
  ids: readonly string[],
): Promise<void> {
  const rows = await tx
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(
        eq(participants.groupId, groupId),
        inArray(participants.id, [...new Set(ids)]),
        isNull(participants.removedAt),
      ),
    );
  if (rows.length !== new Set(ids).size) {
    throw new AuthorizationError(
      "One or more of those people are not part of this group.",
    );
  }
}

/**
 * The repayment a client key has already written, or null.
 *
 * `expenseForClientKey`'s twin, read the same way: outside any transaction, as
 * the fast path, with the unique index behind it for two replays that arrive
 * together. It asks for a repayment by name because the index is on the group
 * and the key alone — a key an expense has spent is not a repayment, and
 * handing its id back as one would point a client at a row that is not there.
 */
export async function settlementForClientKey(
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
        eq(entryClientKeys.entityType, "settlement"),
      ),
    )
    .limit(1);
  return existing?.entityId ?? null;
}

export interface WrittenSettlement {
  readonly settlementId: string;
  /** For the caller to dispatch once the transaction has committed. */
  readonly notificationIds: string[];
  readonly converted: boolean;
}

/**
 * Writes one repayment inside a transaction somebody else holds: the row, its
 * client key if it has one, its activity event and its notifications.
 *
 * Separate from `createSettlement` so that a change of kind can write the
 * repayment and remove the expense it replaces in the same commit — see
 * `convertExpenseToSettlement`. For the same reason it dispatches nothing:
 * the notification ids go back to whoever owns the transaction, to be pushed
 * once it has committed and not a moment before.
 */
export async function writeSettlement(
  tx: Database,
  access: GroupAccess,
  input: SettlementInput,
  options: { now?: Date; rateSource: ExchangeRateSource; clientKey?: string },
): Promise<WrittenSettlement> {
  await assertParticipants(tx, access.groupId, [
    input.fromParticipantId,
    input.toParticipantId,
  ]);

  const conversion = resolveConversion({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    amount: money(BigInt(input.amount), input.currency),
    rate: input.exchangeRate ? input.exchangeRate : undefined,
    source: options.rateSource,
    capturedAt: options.now,
  });

  const insertedSettlement = await tx
    .insert(settlements)
    .values({
      groupId: access.groupId,
      fromParticipantId: input.fromParticipantId,
      toParticipantId: input.toParticipantId,
      amount: BigInt(input.amount),
      currency: input.currency,
      convertedAmount: conversion.frozenRate
        ? conversion.effective.amount
        : null,
      convertedCurrency: conversion.frozenRate
        ? conversion.effective.currency
        : null,
      exchangeRate: conversion.frozenRate?.rate ?? null,
      exchangeRateSource: conversion.frozenRate?.source ?? null,
      exchangeRateAt: conversion.frozenRate?.capturedAt ?? null,
      settledOn: input.settledOn,
      paymentMethod: input.paymentMethod || null,
      notes: input.notes || null,
      createdByActorType: access.actor.kind,
      createdByParticipantId: access.participantId,
    })
    .returning({ id: settlements.id });
  const settlement = onlyRow(insertedSettlement, "the settlement insert");

  // Spent beside the row it names, exactly as `createExpense` spends an
  // expense's: either both are there or neither is, and a replay that raced
  // past the fast path lands on the unique index here and takes its duplicate
  // down with it.
  if (options.clientKey) {
    await tx.insert(entryClientKeys).values({
      groupId: access.groupId,
      clientKey: options.clientKey,
      entityType: "settlement",
      entityId: settlement.id,
    });
  }

  await recordActivity(tx, {
    groupId: access.groupId,
    action: "settlement.created",
    entityType: "settlement",
    entityId: settlement.id,
    ...activityActorFrom(access),
    metadata: {
      amount: input.amount,
      currency: input.currency,
      from: input.fromParticipantId,
      to: input.toParticipantId,
    },
  });

  const notificationIds = await recordSettlementNotification(tx, access, {
    type: "settlement.created",
    settlementId: settlement.id,
    fromParticipantId: input.fromParticipantId,
    toParticipantId: input.toParticipantId,
    amount: BigInt(input.amount),
    currency: input.currency,
  });

  return {
    settlementId: settlement.id,
    notificationIds,
    converted: conversion.frozenRate !== null,
  };
}

/**
 * Records a repayment.
 *
 * `clientKey` makes the call idempotent, by the same mechanism and with the
 * same rules as `createExpense` — one row in `entry_client_keys`, spent for
 * good, deletion included. A repayment needs it at least as much as an expense
 * does: the button is pressed at the moment somebody has just been handed
 * money, often twice, and a second copy does not merely overstate a total — it
 * pays the debt again and tips the debtor into credit.
 */
export async function createSettlement(
  access: GroupAccess,
  input: SettlementInput,
  options: { db?: Database; now?: Date; clientKey?: string } = {},
): Promise<string> {
  requirePermission(access, "addSettlement");
  const db = options.db ?? getDb();

  if (options.clientKey) {
    const already = await settlementForClientKey(
      db,
      access.groupId,
      options.clientKey,
    );
    if (already) return already;
  }

  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.settledOn,
  });

  // The backstop under the fast path, as in `createExpense`: two replays that
  // both got past it race to the unique index, one commits, and the other
  // lands here to read what the first one wrote.
  let created: WrittenSettlement;
  try {
    created = await db.transaction((tx) =>
      writeSettlement(tx, access, input, {
        now: options.now,
        rateSource,
        clientKey: options.clientKey,
      }),
    );
  } catch (error) {
    if (options.clientKey && isUniqueViolation(error)) {
      const already = await settlementForClientKey(
        db,
        access.groupId,
        options.clientKey,
      );
      if (already) return already;
    }
    throw error;
  }

  await dispatchNotifications(created.notificationIds);

  // One boolean: whether the payment crossed a currency. Not who paid whom,
  // not how much, not by what method.
  await telemetry.settlementCreated({ multiCurrency: created.converted });

  return created.settlementId;
}

export async function updateSettlement(
  access: GroupAccess,
  settlementId: string,
  input: SettlementInput,
  options: { db?: Database; now?: Date } = {},
): Promise<void> {
  requirePermission(access, "addSettlement");
  const db = options.db ?? getDb();

  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.settledOn,
  });

  const notificationIds = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: settlements.id })
      .from(settlements)
      .where(
        and(
          eq(settlements.id, settlementId),
          eq(settlements.groupId, access.groupId),
          isNull(settlements.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new AuthorizationError(
        "That settlement is not part of this group.",
        "notInGroup",
      );
    }

    await assertParticipants(tx, access.groupId, [
      input.fromParticipantId,
      input.toParticipantId,
    ]);

    const conversion = resolveConversion({
      mode: access.group.currencyMode,
      baseCurrency: access.group.baseCurrency,
      amount: money(BigInt(input.amount), input.currency),
      rate: input.exchangeRate ? input.exchangeRate : undefined,
      source: rateSource,
      capturedAt: options.now,
    });

    await tx
      .update(settlements)
      .set({
        fromParticipantId: input.fromParticipantId,
        toParticipantId: input.toParticipantId,
        amount: BigInt(input.amount),
        currency: input.currency,
        convertedAmount: conversion.frozenRate
          ? conversion.effective.amount
          : null,
        convertedCurrency: conversion.frozenRate
          ? conversion.effective.currency
          : null,
        exchangeRate: conversion.frozenRate?.rate ?? null,
        exchangeRateSource: conversion.frozenRate?.source ?? null,
        exchangeRateAt: conversion.frozenRate?.capturedAt ?? null,
        settledOn: input.settledOn,
        // Written back like every other field of a full replace. Left out, a
        // repayment re-filed from TWINT to cash kept saying TWINT, and the
        // form reported the change as saved.
        paymentMethod: input.paymentMethod || null,
        notes: input.notes || null,
        updatedAt: new Date(),
      })
      .where(eq(settlements.id, settlementId));

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "settlement.updated",
      entityType: "settlement",
      entityId: settlementId,
      ...activityActorFrom(access),
      metadata: { amount: input.amount, currency: input.currency },
    });

    return recordSettlementNotification(tx, access, {
      type: "settlement.updated",
      settlementId,
      fromParticipantId: input.fromParticipantId,
      toParticipantId: input.toParticipantId,
      amount: BigInt(input.amount),
      currency: input.currency,
    });
  });

  await dispatchNotifications(notificationIds);
}

/**
 * Soft-deletes one repayment inside a transaction somebody else holds, and
 * hands back the notification ids for them to dispatch after their commit.
 * `writeSettlement`'s counterpart; the note there says why these are apart.
 */
export async function removeSettlement(
  tx: Database,
  access: GroupAccess,
  settlementId: string,
): Promise<string[]> {
  const deleted = await tx
    .update(settlements)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(settlements.id, settlementId),
        eq(settlements.groupId, access.groupId),
        isNull(settlements.deletedAt),
      ),
    )
    .returning({
      id: settlements.id,
      amount: settlements.amount,
      currency: settlements.currency,
      fromParticipantId: settlements.fromParticipantId,
      toParticipantId: settlements.toParticipantId,
    });

  const [deletedSettlement] = deleted;
  if (!deletedSettlement) {
    throw new AuthorizationError(
      "That settlement is not part of this group.",
      "notInGroup",
    );
  }

  await recordActivity(tx, {
    groupId: access.groupId,
    action: "settlement.deleted",
    entityType: "settlement",
    entityId: settlementId,
    ...activityActorFrom(access),
    metadata: {
      amount: deletedSettlement.amount.toString(),
      currency: deletedSettlement.currency,
    },
  });

  return recordSettlementNotification(tx, access, {
    type: "settlement.deleted",
    settlementId,
    fromParticipantId: deletedSettlement.fromParticipantId,
    toParticipantId: deletedSettlement.toParticipantId,
    amount: deletedSettlement.amount,
    currency: deletedSettlement.currency,
  });
}

export async function deleteSettlement(
  access: GroupAccess,
  settlementId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "addSettlement");
  const db = options.db ?? getDb();

  const notificationIds = await db.transaction((tx) =>
    removeSettlement(tx, access, settlementId),
  );

  await dispatchNotifications(notificationIds);
}

/**
 * Puts a deleted repayment back — the Undo behind the deletion toast.
 *
 * A settlement carries its whole self in one row, so unlike an expense there
 * is nothing alongside it to put back: clearing `deleted_at` restores both
 * ends of the payment at once. It is the counterpart of `restoreExpense`, and
 * carries the same guard and the same silence about notifications; the note
 * there explains why.
 */
export async function restoreSettlement(
  access: GroupAccess,
  settlementId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "addSettlement");
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const restored = await tx
      .update(settlements)
      .set({ deletedAt: null })
      .where(
        and(
          eq(settlements.id, settlementId),
          eq(settlements.groupId, access.groupId),
          isNotNull(settlements.deletedAt),
        ),
      )
      .returning({
        amount: settlements.amount,
        currency: settlements.currency,
      });

    const [restoredSettlement] = restored;
    if (!restoredSettlement) {
      throw new AuthorizationError(
        "That settlement is not part of this group.",
        "notInGroup",
      );
    }

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "settlement.restored",
      entityType: "settlement",
      entityId: settlementId,
      ...activityActorFrom(access),
      metadata: {
        amount: restoredSettlement.amount.toString(),
        currency: restoredSettlement.currency,
      },
    });
  });
}

export async function listSettlements(
  groupId: string,
  options: { db?: Database; limit?: number; before?: ListCursor | null } = {},
): Promise<ListedSettlement[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      cursorKey: keysetTime(settlements.createdAt),
      id: settlements.id,
      fromParticipantId: settlements.fromParticipantId,
      toParticipantId: settlements.toParticipantId,
      amount: settlements.amount,
      currency: settlements.currency,
      convertedAmount: settlements.convertedAmount,
      convertedCurrency: settlements.convertedCurrency,
      exchangeRate: settlements.exchangeRate,
      settledOn: settlements.settledOn,
      notes: settlements.notes,
      createdAt: settlements.createdAt,
    })
    .from(settlements)
    .where(
      and(
        eq(settlements.groupId, groupId),
        isNull(settlements.deletedAt),
        options.before
          ? keysetBefore(
              {
                date: settlements.settledOn,
                time: settlements.createdAt,
                id: settlements.id,
              },
              options.before,
            )
          : undefined,
      ),
    )
    .orderBy(
      desc(settlements.settledOn),
      desc(settlements.createdAt),
      desc(settlements.id),
    )
    .limit(options.limit ?? 100);

  if (rows.length === 0) return [];

  const names = await db
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(eq(participants.groupId, groupId));
  const nameById = new Map(names.map((row) => [row.id, row.displayName]));

  return rows.map((row) => ({
    ...row,
    fromName: nameById.get(row.fromParticipantId) ?? "Unknown",
    toName: nameById.get(row.toParticipantId) ?? "Unknown",
  }));
}

/**
 * Whether the group has ever recorded a repayment.
 *
 * Asked separately from the list because the kind chips must describe the
 * group, not the page: a Settlements chip that appeared only once the reader
 * had scrolled far enough to reach one would be a control that arrives after
 * the moment it was useful.
 */
export async function hasSettlements(
  groupId: string,
  options: { db?: Database } = {},
): Promise<boolean> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({ id: settlements.id })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)))
    .limit(1);
  return row !== undefined;
}

/**
 * How this group usually pays each other back.
 *
 * A hint, and deliberately not a default. Nothing on the settle screen is
 * preselected — a lit chip is a claim, and the country's first suggestion
 * arriving lit recorded "TWINT" on repayments that were nothing of the kind —
 * but a flatshare that has settled by TWINT eleven times is saying something,
 * and saying it beside the tiles pre-empts nothing.
 *
 * The label rather than a code, because the label is what the column holds: a
 * repayment recorded as "TWINT" still says TWINT years after the picker's list
 * has moved on, and imports arrive with names nothing here ever offered. The
 * row matches it back by name and simply shows nothing when it cannot.
 *
 * Ties go to whichever was used most recently. Without that a two-all split
 * between cash and TWINT would come back in whatever order the planner felt
 * like, and the hint would change between visits with nothing behind it.
 */
export async function mostUsedPaymentMethod(
  groupId: string,
  options: { db?: Database } = {},
): Promise<string | null> {
  const db = options.db ?? getDb();
  const uses = count();
  const [row] = await db
    .select({ method: settlements.paymentMethod, uses })
    .from(settlements)
    .where(
      and(
        eq(settlements.groupId, groupId),
        isNull(settlements.deletedAt),
        isNotNull(settlements.paymentMethod),
        ne(settlements.paymentMethod, ""),
      ),
    )
    .groupBy(settlements.paymentMethod)
    .orderBy(desc(uses), desc(max(settlements.createdAt)))
    .limit(1);
  return row?.method ?? null;
}

/**
 * One settlement, with everything the edit screen has to put back on screen.
 *
 * `listSettlements` deliberately does not carry the payment method — a list of
 * repayments is about who and how much — but reopening one has to, or saving an
 * untouched form would quietly restate a TWINT payment as cash.
 */
export async function getSettlement(
  groupId: string,
  settlementId: string,
  options: { db?: Database } = {},
): Promise<(SettlementSummary & { paymentMethod: string | null }) | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({
      id: settlements.id,
      fromParticipantId: settlements.fromParticipantId,
      toParticipantId: settlements.toParticipantId,
      amount: settlements.amount,
      currency: settlements.currency,
      convertedAmount: settlements.convertedAmount,
      convertedCurrency: settlements.convertedCurrency,
      exchangeRate: settlements.exchangeRate,
      settledOn: settlements.settledOn,
      paymentMethod: settlements.paymentMethod,
      notes: settlements.notes,
      createdAt: settlements.createdAt,
    })
    .from(settlements)
    .where(
      and(
        eq(settlements.id, settlementId),
        eq(settlements.groupId, groupId),
        isNull(settlements.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  const names = await db
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(eq(participants.groupId, groupId));
  const nameById = new Map(names.map((name) => [name.id, name.displayName]));

  return {
    ...row,
    fromName: nameById.get(row.fromParticipantId) ?? "Unknown",
    toName: nameById.get(row.toParticipantId) ?? "Unknown",
  };
}
