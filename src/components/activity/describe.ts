import type { ActivityEntry } from "@/modules/activity/service";

/**
 * The wording of one activity event.
 *
 * Action ids are dotted ("expense.created"), which is also how next-intl
 * addresses nested keys, so an id maps straight onto `actions.expense.created`.
 * An id with no entry falls back to the raw value: an event written by a newer
 * version should still show something rather than break the page.
 *
 * Shared by the full feed and the overview's "since you last opened" list, so
 * the same event cannot be described two different ways on two screens.
 */

/** Just enough of next-intl's translator to look an action up. */
export interface ActivityTranslate {
  (key: string, values?: Record<string, string>): string;
  has(key: string): boolean;
}

export function describeActivity(
  entry: ActivityEntry,
  t: ActivityTranslate,
): string {
  const base = t.has(`actions.${entry.action}`)
    ? t(`actions.${entry.action}`)
    : entry.action;
  const description = entry.metadata?.description;
  if (typeof description === "string" && description.length > 0) {
    return t("withDescription", { action: base, description });
  }
  return base;
}

/** Who did it, with the two stand-ins for "nobody in particular". */
export function actorOf(entry: ActivityEntry, t: ActivityTranslate): string {
  if (entry.actorLabel) return entry.actorLabel;
  return entry.actorType === "system" ? "Balancia" : t("someone");
}
