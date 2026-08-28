import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
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

export async function deleteSettlement(
  access: GroupAccess,
  settlementId: string,
  options: { db?: Database } = {},
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
