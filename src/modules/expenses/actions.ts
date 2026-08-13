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
  revalidatePath(`/groups/${groupId}/balances`);
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
