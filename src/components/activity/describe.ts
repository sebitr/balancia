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

  /*
   * The person an event was about, when the event is about a person.
   *
   * Every `participant.*` event has recorded a `displayName` since it was
   * written, and nothing ever read it: the feed said "added someone to the
   * group" twice in a row, which is the one fact those lines carry and the
   * one they left out. `actionsNamed` is a parallel to `actions` rather than
   * more keys inside it, so an id still maps onto exactly one action phrase
   * and the named form is a rendering choice made here.
   */
  const name = entry.metadata?.displayName;
  if (
    typeof name === "string" &&
    name.length > 0 &&
    t.has(`actionsNamed.${entry.action}`)
  ) {
    return t(`actionsNamed.${entry.action}`, { name });
  }

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
