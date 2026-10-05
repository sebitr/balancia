import "server-only";
import { getDb, type Database } from "@/lib/db/client";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  requirePermission,
  type GroupAccess,
} from "@/lib/security/authorization";
import { telemetry } from "@/lib/telemetry";
import { classifyRateSource } from "@/modules/currencies/rates";
import { dispatchNotifications } from "@/modules/notifications/service";
import {
  removeSettlement,
  settlementForClientKey,
  writeSettlement,
} from "@/modules/settlements/service";
import type { ExpenseInput, SettlementInput } from "./schemas";
import { expenseForClientKey, removeExpense, writeExpense } from "./service";

/**
 * Changing an entry's kind across the two tables it can live in.
 *
 * Expense and income are one row with a sign, so switching between them is an
 * ordinary update. A repayment is not: it is modelled separately precisely so
 * that spending and settling cannot blur, which means "this was actually Alice
 * paying me back" has to move the row from one table to the other.
 *
 * The move is one transaction — the new row and the removal of the old one
 * commit together or not at all. It used to be a create followed by a delete,
 * each committing on its own, and a double submit then left two repayments
 * behind and an error: the second call's create had committed before its
 * delete found the expense already gone. That is why these are built from
 * `writeSettlement` and `removeExpense` rather than from the public create and
 * delete. Those dispatch their notifications after their own commit, and
 * nested inside this transaction they would hand the dispatcher ids no other
 * connection could see yet; the pieces hand the ids back instead, and they are
 * dispatched here once the whole move has committed.
 *
 * `clientKey` is the form's, and makes a move idempotent the way it makes a
 * create idempotent: it is spent on the new row, so a replay finds it and
 * answers with the row the first call made, without writing or removing
 * anything. Two moves racing on one key meet at the unique index exactly as two
 * creates do, and the loser's transaction rolls back before it has removed
 * anything, taking its copy of the new row with it.
 *
 * A move that fails for any other reason leaves the entry where it was, under
 * its old kind — which is also what the reader was looking at when they
 * pressed the button.
 *
 * The old row's deletion names the new one as `replacedBy`, so the Activity
 * screen does not offer it back: restoring it beside its replacement would
 * count the same money twice. See `findRestorableDeletions`.
 */

export async function convertExpenseToSettlement(
  access: GroupAccess,
  expenseId: string,
  input: SettlementInput,
  options: { db?: Database; now?: Date; clientKey?: string } = {},
): Promise<string> {
  // Both halves' permissions, before either half is attempted.
  requirePermission(access, "addSettlement");
  requirePermission(access, "editAnyExpense");
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

  const move = () =>
    db.transaction(async (tx) => {
      const written = await writeSettlement(tx, access, input, {
        now: options.now,
        rateSource,
        clientKey: options.clientKey,
      });
      const removed = await removeExpense(tx, access, expenseId, {
        replacedBy: written.settlementId,
      });
      return {
        ...written,
        notificationIds: [...written.notificationIds, ...removed],
      };
    });

  let moved: Awaited<ReturnType<typeof move>>;
  try {
    moved = await move();
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

  await dispatchNotifications(moved.notificationIds);
  await telemetry.settlementCreated({ multiCurrency: moved.converted });

  return moved.settlementId;
}

/** The same move in reverse: a repayment that was really a purchase. */
export async function convertSettlementToExpense(
  access: GroupAccess,
  settlementId: string,
  input: ExpenseInput,
  options: { db?: Database; now?: Date; clientKey?: string } = {},
): Promise<string> {
  requirePermission(access, "addExpense");
  requirePermission(access, "addSettlement");
  const db = options.db ?? getDb();

  if (options.clientKey) {
    const already = await expenseForClientKey(
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
    on: input.expenseDate,
  });

  const move = () =>
    db.transaction(async (tx) => {
      const written = await writeExpense(tx, access, input, {
        now: options.now,
        rateSource,
        clientKey: options.clientKey,
      });
      const removed = await removeSettlement(tx, access, settlementId, {
        replacedBy: written.expenseId,
      });
      return {
        ...written,
        notificationIds: [...written.notificationIds, ...removed],
      };
    });

  let moved: Awaited<ReturnType<typeof move>>;
  try {
    moved = await move();
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

  await dispatchNotifications(moved.notificationIds);
  await telemetry.expenseCreated({
    splitMethod: input.splitMethod,
    direction: input.direction ?? "out",
    multiCurrency: moved.converted,
    hasReceipt: (input.attachmentIds?.length ?? 0) > 0,
    participantCount: moved.shareCount,
  });

  return moved.expenseId;
}
