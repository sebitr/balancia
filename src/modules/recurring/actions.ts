"use server";

import { revalidatePath } from "next/cache";
import {
  actionError,
  requireGroupAccess,
  runAction,
  type ActionResult,
} from "@/lib/actions";
import {
  createRecurringExpense,
  deleteRecurringExpense,
  recurringInputSchema,
  setRecurringPaused,
} from "./service";

export async function createRecurringAction(
  groupId: string,
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = recurringInputSchema.safeParse(payload);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const result = await runAction("recurring.create", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    const id = await createRecurringExpense(access, parsed.data);
    return { id };
  });

  if (result.ok) revalidatePath(`/groups/${groupId}/recurring`);
  return result;
}

export async function setRecurringPausedAction(
  groupId: string,
  templateId: string,
  paused: boolean,
): Promise<ActionResult> {
  const result = await runAction("recurring.pause", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await setRecurringPaused(access, templateId, paused);
  });

  if (result.ok) revalidatePath(`/groups/${groupId}/recurring`);
  return result;
}

export async function deleteRecurringAction(
  groupId: string,
  templateId: string,
): Promise<ActionResult> {
  const result = await runAction("recurring.delete", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await deleteRecurringExpense(access, templateId);
  });

  if (result.ok) revalidatePath(`/groups/${groupId}/recurring`);
  return result;
}
