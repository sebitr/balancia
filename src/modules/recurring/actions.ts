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
  deleteRecurringExpense,
  recurringInputSchema,
  restoreRecurringExpense,
  setRecurringPaused,
  setUpRecurringExpense,
  type RecurringSetUp,
} from "./service";

/**
 * Saves a series, and adds the entries whose dates have already come — see
 * `setUpRecurringExpense`. The answer says how many and when the next one is,
 * which is what the confirmation is built from.
 *
 * Revalidates the group's screens the way adding an expense does, because it
 * may just have added one: the balances, the transactions and the settle-up
 * suggestions all move with it.
 */
export async function createRecurringAction(
  groupId: string,
  payload: unknown,
): Promise<ActionResult<RecurringSetUp>> {
  const parsed = recurringInputSchema.safeParse(payload);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const result = await runAction("recurring.create", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    return setUpRecurringExpense(access, parsed.data);
  });

  if (result.ok) {
    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/groups/${groupId}/expenses`);
    revalidatePath(`/groups/${groupId}/settle`);
    revalidatePath(`/groups/${groupId}/recurring`);
  }
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
