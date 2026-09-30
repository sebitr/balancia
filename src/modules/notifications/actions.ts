"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getCurrentActor, getCurrentUser } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  markRead,
  savePreferences,
  setGroupMuted,
  setGroupSnoozed,
} from "./service";
import type { NotificationPreferences } from "./types";

/**
 * Notification settings and the inbox's own writes.
 *
 * Everything here acts on the caller's own rows only. There is no notion of
 * changing someone else's preferences, so none of these takes a user id.
 *
 * The arguments are checked at runtime, as the API routes beside them check
 * their bodies. `Boolean("false")` is true, so coercing the switches meant a
 * caller sending strings turned on the very thing it asked to turn off; and
 * an id that is not a UUID reached PostgreSQL, which refused the whole query.
 */

const preferencesSchema = z.object({
  expenses: z.boolean(),
  settlements: z.boolean(),
  recurring: z.boolean(),
  imports: z.boolean(),
  reminders: z.boolean(),
});

/** The inbox shows fifty rows; the ceiling is the API's own. */
const markReadSchema = z.array(z.uuid()).max(100).optional();

/**
 * The mute switch and the group it names. The service branches on `if (muted)`,
 * so the word `"false"` silenced the very group it asked to hear from again.
 */
const setGroupMutedSchema = z.object({
  groupId: z.uuid(),
  muted: z.boolean(),
});

export async function savePreferencesAction(
  preferences: NotificationPreferences,
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");
  const user = await getCurrentUser();
  if (!user) return actionError(t("signedInRequired"));

  const parsed = preferencesSchema.safeParse(preferences);
  if (!parsed.success) return actionError(t("malformedRequest"));

  return runAction("saveNotificationPreferences", async () => {
    await savePreferences(user.userId, parsed.data);
    revalidatePath("/settings/notifications");
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

  const parsed = setGroupMutedSchema.safeParse({ groupId, muted });
  if (!parsed.success) return actionError(t("malformedRequest"));

  return runAction("setGroupMuted", async () => {
    const access = await authorizeGroup(
      await getCurrentActor(),
      parsed.data.groupId,
    );
    await setGroupMuted(user.userId, access.groupId, parsed.data.muted);
    revalidatePath("/settings/notifications");
  });
}

/**
 * Quietens a group until tomorrow, or lifts the quiet early.
 *
 * `hours` is a duration rather than an instant on purpose: the wake time is
 * computed on the server, so a device with a wrong clock — or a caller minded
 * to send one — cannot buy itself a silence of any length it likes. Null lifts
 * a snooze that is already running.
 */
export async function setGroupSnoozedAction(
  groupId: string,
  hours: number | null,
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");
  const user = await getCurrentUser();
  if (!user) return actionError(t("signedInRequired"));

  return runAction("setGroupSnoozed", async () => {
    const access = await authorizeGroup(await getCurrentActor(), groupId);
    const until =
      hours === null
        ? null
        : new Date(Date.now() + clampHours(hours) * 60 * 60 * 1000);
    await setGroupSnoozed(user.userId, access.groupId, until);
    revalidatePath("/notifications");
  });
}

/** A snooze is a day, give or take. Anything longer is a mute by another name. */
function clampHours(hours: number): number {
  if (!Number.isFinite(hours)) return 24;
  return Math.min(24 * 7, Math.max(1, Math.round(hours)));
}

export async function markReadAction(
  notificationIds?: readonly string[],
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");
  const user = await getCurrentUser();
  if (!user) return actionError(t("signedInRequired"));

  const parsed = markReadSchema.safeParse(notificationIds);
  if (!parsed.success) return actionError(t("malformedRequest"));

  return runAction("markNotificationsRead", async () => {
    await markRead(user.userId, parsed.data);
    revalidatePath("/notifications");
  });
}
