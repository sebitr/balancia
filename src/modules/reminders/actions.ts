"use server";

import { revalidatePath } from "next/cache";
import {
  requireGroupAccess,
  runAction,
  type ActionResult,
} from "@/lib/actions";
import { sendReminder } from "./service";
import type { RemindResult } from "./types";

/**
 * Sending a reminder.
 *
 * The action takes only the recipient and the words: who owes what, whether
 * the sender is allowed to ask, and which channel it takes are all re-derived
 * on the server, because none of them is safe to accept from a client.
 */
export async function sendReminderAction(
  groupId: string,
  input: {
    toParticipantId: string;
    message: string;
    logToActivity: boolean;
  },
): Promise<ActionResult<RemindResult>> {
  return runAction("sendReminder", async () => {
    const access = await requireGroupAccess(groupId, { requireActive: true });
    const result = await sendReminder(access, {
      toParticipantId: input.toParticipantId,
      message: input.message,
      logToActivity: Boolean(input.logToActivity),
    });
    // The row the reminder came from now shows when it went out.
    revalidatePath(`/groups/${groupId}`);
    return result;
  });
}
