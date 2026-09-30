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
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb, onlyRow, type Database } from "@/lib/db/client";
import { keysetBefore, keysetTime, type ListCursor } from "@/lib/db/keyset";
import { participants, settlements } from "@/lib/db/schema";
import {
  AuthorizationError,
  requirePermission,
  type GroupAccess,
} from "@/lib/security/authorization";
import { activityActorFrom, recordActivity } from "@/modules/activity/service";
import { dispatchNotifications } from "@/modules/notifications/service";
import { recordSettlementNotification } from "@/modules/notifications/events";
import { resolveConversion } from "@/modules/currencies/conversion";
import { money } from "@/modules/currencies/money";
import { classifyRateSource } from "@/modules/currencies/rates";
import { telemetry } from "@/lib/telemetry";
import type { SettlementInput } from "@/modules/expenses/schemas";
import {
  EditConflictError,
  entryVersion,
  nextVersion,
  versionIs,
} from "@/modules/expenses/edit-conflict";

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
      "participantNotInGroup",
    );
  }
}

export async function createSettlement(
  access: GroupAccess,
  input: SettlementInput,
  options: { db?: Database; now?: Date } = {},
): Promise<string> {
  requirePermission(access, "addSettlement");
  const db = options.db ?? getDb();

  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.settledOn,
  });

  const created = await db.transaction(async (tx) => {
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
  });

  await dispatchNotifications(created.notificationIds);

  // One boolean: whether the payment crossed a currency. Not who paid whom,
  // not how much, not by what method.
  await telemetry.settlementCreated({ multiCurrency: created.converted });

  return created.settlementId;
}

/**
 * Replaces a repayment with `input`, whole.
 *
 * `expectedVersion` works exactly as it does on `updateExpense`: the version
 * `getSettlement` handed out, refused with an `EditConflictError` if somebody
 * has changed the repayment since, and no check at all when it is absent.
 *
 * Returns the version the repayment has now.
 */
export async function updateSettlement(
  access: GroupAccess,
  settlementId: string,
  input: SettlementInput,
  options: { db?: Database; now?: Date; expectedVersion?: string } = {},
): Promise<string> {
  requirePermission(access, "addSettlement");
  const db = options.db ?? getDb();

  const rateSource = await classifyRateSource({
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
    currency: input.currency,
    rate: input.exchangeRate,
    on: input.settledOn,
  });

  const { notificationIds, version } = await db.transaction(async (tx) => {
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

    const updated = await tx
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
        notes: input.notes || null,
        updatedAt: nextVersion(settlements.updatedAt),
      })
      .where(
        and(
          eq(settlements.id, settlementId),
          eq(settlements.groupId, access.groupId),
          options.expectedVersion === undefined
            ? undefined
            : versionIs(settlements.updatedAt, options.expectedVersion),
        ),
      )
      .returning({ version: entryVersion(settlements.updatedAt) });

    // Empty only when the version moved — see the same check in
    // `updateExpense`. Nothing has been written that this does not undo.
    const [written] = updated;
    if (!written) throw new EditConflictError();

    await recordActivity(tx, {
      groupId: access.groupId,
      action: "settlement.updated",
      entityType: "settlement",
      entityId: settlementId,
      ...activityActorFrom(access),
      metadata: { amount: input.amount, currency: input.currency },
    });

    const notificationIds = await recordSettlementNotification(tx, access, {
      type: "settlement.updated",
      settlementId,
      fromParticipantId: input.fromParticipantId,
      toParticipantId: input.toParticipantId,
      amount: BigInt(input.amount),
      currency: input.currency,
    });
    return { notificationIds, version: written.version };
  });

  await dispatchNotifications(notificationIds);

  return version;
}

export async function deleteSettlement(
  access: GroupAccess,
  settlementId: string,
  options: {
    db?: Database;
    /** The expense written in its place; see `deleteExpense`. */
    replacedBy?: string;
  } = {},
): Promise<void> {
  requirePermission(access, "addSettlement");
  const db = options.db ?? getDb();

  const notificationIds = await db.transaction(async (tx) => {
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
        ...(options.replacedBy ? { replacedBy: options.replacedBy } : {}),
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
  });

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

/**
 * Settlements for a group, newest first.
 *
 * `where` and `orderBy` are the transactions list's filters and orders — the
 * same two options `listExpenses` takes, for the same reason.
 */
export async function listSettlements(
  groupId: string,
  options: {
    db?: Database;
    limit?: number;
    before?: ListCursor | null;
    where?: SQL;
    orderBy?: readonly SQL[];
  } = {},
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
        options.where,
      ),
    )
    .orderBy(
      ...(options.orderBy ?? [
        desc(settlements.settledOn),
        desc(settlements.createdAt),
        desc(settlements.id),
      ]),
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
 * The group's repayments, summed per currency and converted currency.
 *
 * Asked separately from the list because the transactions screen's controls
 * must describe the group, not the page. Whether there are any at all decides
 * the Settlements chip — one that appeared only once the reader had scrolled
 * far enough to reach a repayment would be a control that arrives after the
 * moment it was useful. Which currencies they are in decides whether
 * `Largest amount` is a ranking or a coincidence of denominations, and that
 * has to be answered over rows the reader has not loaded yet.
 *
 * Summed rather than listed, for the same reason as `listSpreadEntries`, and
 * in the same shape, so `moneyForGroup` reads a sum exactly as it would read
 * each repayment inside it.
 */
export async function settlementTotals(
  groupId: string,
  options: { db?: Database } = {},
): Promise<
  {
    readonly amount: bigint;
    readonly currency: string;
    readonly convertedAmount: bigint | null;
    readonly convertedCurrency: string | null;
    readonly count: number;
  }[]
> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      currency: settlements.currency,
      convertedCurrency: settlements.convertedCurrency,
      amount: sql<string>`sum(${settlements.amount})::text`,
      convertedAmount: sql<
        string | null
      >`sum(${settlements.convertedAmount})::text`,
      count: count(),
    })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)))
    .groupBy(settlements.currency, settlements.convertedCurrency);

  return rows.map((row) => ({
    ...row,
    amount: BigInt(row.amount),
    convertedAmount:
      row.convertedAmount === null ? null : BigInt(row.convertedAmount),
  }));
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
 *
 * `version` is for the same screen: it goes back to `updateSettlement` as
 * `expectedVersion`, so an edit made from a stale copy is refused.
 */
export async function getSettlement(
  groupId: string,
  settlementId: string,
  options: { db?: Database } = {},
): Promise<
  (SettlementSummary & { paymentMethod: string | null; version: string }) | null
> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({
      version: entryVersion(settlements.updatedAt),
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
