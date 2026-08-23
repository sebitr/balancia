"use server";

import { revalidatePath } from "next/cache";
import {
  actionError,
  requireGroupAccess,
  runAction,
  type ActionResult,
} from "@/lib/actions";
import { expenseInputSchema, settlementInputSchema } from "./schemas";
import { createExpense, deleteExpense, updateExpense } from "./service";
import {
  createSettlement,
  deleteSettlement,
  updateSettlement,
} from "@/modules/settlements/service";

/**
 * Server Actions for expenses and settlements.
 *
 * The client sends JSON (amounts as minor-unit strings) rather than raw
 * FormData because a split carries nested arrays; zod parses it before any
 * service sees it.
 */

function revalidateGroup(groupId: string): void {
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/expenses`);
  revalidatePath(`/groups/${groupId}/settle`);
}

export async function createExpenseAction(
  groupId: string,
  payload: unknown,
): Promise<ActionResult<{ expenseId: string }>> {
  const parsed = expenseInputSchema.safeParse(payload);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the expense.");
  }

  const result = await runAction("expenses.create", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    const expenseId = await createExpense(access, parsed.data);
    return { expenseId };
  });

  if (result.ok) revalidateGroup(groupId);
  return result;
}

export async function updateExpenseAction(
  groupId: string,
  expenseId: string,
  payload: unknown,
): Promise<ActionResult> {
  const parsed = expenseInputSchema.safeParse(payload);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the expense.");
  }

  const result = await runAction("expenses.update", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await updateExpense(access, expenseId, parsed.data);
  });

  if (result.ok) {
    revalidateGroup(groupId);
    revalidatePath(`/groups/${groupId}/expenses/${expenseId}`);
  }
  return result;
}

export async function deleteExpenseAction(
  groupId: string,
  expenseId: string,
): Promise<ActionResult> {
  const result = await runAction("expenses.delete", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await deleteExpense(access, expenseId);
  });

  if (result.ok) revalidateGroup(groupId);
  return result;
}

export async function createSettlementAction(
  groupId: string,
  payload: unknown,
): Promise<ActionResult<{ settlementId: string }>> {
  const parsed = settlementInputSchema.safeParse(payload);
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ?? "Check the settlement.",
    );
  }

  const result = await runAction("settlements.create", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    const settlementId = await createSettlement(access, parsed.data);
    return { settlementId };
  });

  if (result.ok) revalidateGroup(groupId);
  return result;
}

export async function updateSettlementAction(
  groupId: string,
  settlementId: string,
  payload: unknown,
): Promise<ActionResult> {
  const parsed = settlementInputSchema.safeParse(payload);
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ?? "Check the settlement.",
    );
  }

  const result = await runAction("settlements.update", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await updateSettlement(access, settlementId, parsed.data);
  });

  if (result.ok) revalidateGroup(groupId);
  return result;
}

/**
 * Changing an entry's type across the two tables it can live in.
 *
 * Expense and income are one row with a sign, so switching between them is an
 * ordinary update. A repayment is not: it is modelled separately precisely so
 * that spending and settling cannot blur, which means "this was actually Alice
 * paying me back" has to move the row from one table to the other.
 *
 * Written before the old row is removed, and deliberately not wrapped in one
 * transaction. The services record their notifications inside their own
 * transaction and dispatch them once it has committed; nesting would hand the
 * dispatcher ids no other connection can yet see, and the notification would be
 * dropped rather than delayed. Sequential leaves one failure mode — a create
 * that succeeds and a delete that does not — and that way round the reader is
 * left with a visible duplicate they can remove, rather than with nothing.
 */
export async function convertExpenseToSettlementAction(
  groupId: string,
  expenseId: string,
  payload: unknown,
): Promise<ActionResult<{ settlementId: string }>> {
  const parsed = settlementInputSchema.safeParse(payload);
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ?? "Check the settlement.",
    );
  }

  const result = await runAction("expenses.convertToSettlement", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    const settlementId = await createSettlement(access, parsed.data);
    await deleteExpense(access, expenseId);
    return { settlementId };
  });

  if (result.ok) {
    revalidateGroup(groupId);
    revalidatePath(`/groups/${groupId}/expenses/${expenseId}`);
  }
  return result;
}

/** The same move in reverse: a repayment that was really a purchase. */
export async function convertSettlementToExpenseAction(
  groupId: string,
  settlementId: string,
  payload: unknown,
): Promise<ActionResult<{ expenseId: string }>> {
  const parsed = expenseInputSchema.safeParse(payload);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the expense.");
  }

  const result = await runAction("settlements.convertToExpense", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    const expenseId = await createExpense(access, parsed.data);
    await deleteSettlement(access, settlementId);
    return { expenseId };
  });

  if (result.ok) {
    revalidateGroup(groupId);
    revalidatePath(`/groups/${groupId}/settlements/${settlementId}`);
  }
  return result;
}

export async function deleteSettlementAction(
  groupId: string,
  settlementId: string,
): Promise<ActionResult> {
  const result = await runAction("settlements.delete", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await deleteSettlement(access, settlementId);
  });

  if (result.ok) revalidateGroup(groupId);
  return result;
}
