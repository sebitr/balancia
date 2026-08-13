import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
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

  const { settlementId, notificationIds } = await db.transaction(async (tx) => {
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

    const [settlement] = await tx
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
        notes: input.notes || null,
        createdByActorType: access.actor.kind,
        createdByParticipantId: access.participantId,
      })
      .returning({ id: settlements.id });

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

    return { settlementId: settlement.id, notificationIds };
  });

  await dispatchNotifications(notificationIds);
  return settlementId;
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

    if (deleted.length === 0) {
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
        amount: deleted[0].amount.toString(),
        currency: deleted[0].currency,
      },
    });

    return recordSettlementNotification(tx, access, {
      type: "settlement.deleted",
      settlementId,
      fromParticipantId: deleted[0].fromParticipantId,
      toParticipantId: deleted[0].toParticipantId,
      amount: deleted[0].amount,
      currency: deleted[0].currency,
    });
  });

  await dispatchNotifications(notificationIds);
}

export async function listSettlements(
  groupId: string,
  options: { db?: Database; limit?: number } = {},
): Promise<SettlementSummary[]> {
  const db = options.db ?? getDb();
  const rows = await db
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
      notes: settlements.notes,
      createdAt: settlements.createdAt,
    })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)))
    .orderBy(desc(settlements.settledOn), desc(settlements.createdAt))
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
