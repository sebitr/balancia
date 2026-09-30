"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
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
  restoreRecurringExpense,
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

/**
 * Checked at runtime rather than trusted from the signature, like the group's
 * archive switch: `"false"` is truthy, so a caller sending the word paused the
 * series it asked to resume, and a malformed id reached PostgreSQL.
 */
const setRecurringPausedSchema = z.object({
  groupId: z.uuid(),
  templateId: z.uuid(),
  paused: z.boolean(),
});

export async function setRecurringPausedAction(
  groupId: string,
  templateId: string,
  paused: boolean,
): Promise<ActionResult> {
  const parsed = setRecurringPausedSchema.safeParse({
    groupId,
    templateId,
    paused,
  });
  if (!parsed.success) {
    const t = await getTranslations("serverErrors");
    return actionError(t("malformedRequest"));
  }

  const result = await runAction("recurring.pause", async () => {
    const access = await requireGroupAccess(parsed.data.groupId, {
      requireActive: true,
    });
    await setRecurringPaused(
      access,
      parsed.data.templateId,
      parsed.data.paused,
    );
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

/**
 * Undo for a removal, offered by the toast the removal raises and afterwards
 * by the group's Activity screen.
 */
export async function restoreRecurringAction(
  groupId: string,
  templateId: string,
): Promise<ActionResult> {
  const result = await runAction("recurring.restore", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    await restoreRecurringExpense(access, templateId);
  });

  if (result.ok) revalidatePath(`/groups/${groupId}/recurring`);
  return result;
}
