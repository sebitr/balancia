"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getCurrentActor, getCurrentUser } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { markRead, savePreferences, setGroupMuted } from "./service";
import type { NotificationPreferences } from "./types";

/**
 * Notification settings and the inbox's own writes.
 *
 * Everything here acts on the caller's own rows only. There is no notion of
 * changing someone else's preferences, so none of these takes a user id.
 */

export async function savePreferencesAction(
  preferences: NotificationPreferences,
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");
  const user = await getCurrentUser();
  if (!user) return actionError(t("signedInRequired"));

  return runAction("saveNotificationPreferences", async () => {
    await savePreferences(user.userId, {
      expenses: Boolean(preferences.expenses),
      settlements: Boolean(preferences.settlements),
      recurring: Boolean(preferences.recurring),
      imports: Boolean(preferences.imports),
      reminders: Boolean(preferences.reminders),
    });
    revalidatePath("/profile/notifications");
  });
}

/**
 * Silences or unsilences a group.
 *
 * Authorized like any other group-scoped write: a mute names a group, and
 * accepting one for a group the caller cannot see would let them probe which
 * group ids exist.
 */
export async function setGroupMutedAction(
  groupId: string,
  muted: boolean,
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");
  const user = await getCurrentUser();
  if (!user) return actionError(t("signedInRequired"));

  return runAction("setGroupMuted", async () => {
    const access = await authorizeGroup(await getCurrentActor(), groupId);
    await setGroupMuted(user.userId, access.groupId, muted);
    revalidatePath("/profile/notifications");
  });
}

export async function markReadAction(
  notificationIds?: readonly string[],
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");
  const user = await getCurrentUser();
  if (!user) return actionError(t("signedInRequired"));

  return runAction("markNotificationsRead", async () => {
    await markRead(user.userId, notificationIds);
    revalidatePath("/notifications");
  });
}
