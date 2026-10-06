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
  /**
   * The reader's own row in the group, so that a line about them can say
   * "you". Null where it is not known, which only ever costs the "you".
   */
  viewerId: string | null = null,
): string {
  /*
   * Somebody who left. Leaving writes the removal event, because the action
   * is a database enum and a new kind would need a migration; what tells the
   * two apart is that a person who leaves is their own actor. The feed puts
   * the actor's name in front, so this reads "Ada left the group", not "Ada
   * removed Ada from the group".
   */
  if (
    entry.action === "participant.removed" &&
    entry.actorParticipantId !== null &&
    entry.actorParticipantId === entry.entityId
  ) {
    return t("left");
  }

  const link = describeLinkEvent(entry, t, viewerId);
  if (link !== null) return link;

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

/**
 * A personal link: sent to somebody, revoked, or opened by them.
 *
 * The events are named `guest_link.*` in the database, and the feed used to
 * call them that — "created a guest link" — while the People screen called the
 * same thing an invite link and the group's own link was an invite link too.
 * Three names for two links, so nobody could tell which one a line was about.
 * Here, as on the People screen, the one that belongs to a person is their
 * personal link and the one the whole group shares is the group link.
 *
 * Joining through the group link writes `guest_link.created` as well, with
 * the newcomer as their own actor and `via: "join_link"` beside it, because
 * the join mints a personal link behind the scenes. Nobody sent anybody
 * anything, so it is told as the join it was.
 *
 * Whom a link was for is in the metadata — `participantName` always, and
 * `participantId` on events written since the feed started reading it. Older
 * rows lack one or the other and fall back to the phrase without them.
 */
function describeLinkEvent(
  entry: ActivityEntry,
  t: ActivityTranslate,
  viewerId: string | null,
): string | null {
  if (!entry.action.startsWith("guest_link.")) return null;
  const metadata = entry.metadata ?? {};

  if (entry.action === "guest_link.created" && metadata.via === "join_link") {
    return t("joinedWithGroupLink");
  }

  const personId = metadata.participantId;
  if (
    viewerId !== null &&
    personId === viewerId &&
    // Their own link opened by themselves is not news about "you" twice.
    entry.actorParticipantId !== viewerId &&
    t.has(`actionsYou.${entry.action}`)
  ) {
    return t(`actionsYou.${entry.action}`);
  }

  const name = metadata.participantName;
  if (
    typeof name === "string" &&
    name.length > 0 &&
    t.has(`actionsNamed.${entry.action}`)
  ) {
    return t(`actionsNamed.${entry.action}`, { name });
  }
  return null;
}

/** Who did it, with the two stand-ins for "nobody in particular". */
export function actorOf(entry: ActivityEntry, t: ActivityTranslate): string {
  if (entry.actorLabel) return entry.actorLabel;
  return entry.actorType === "system" ? "Balancia" : t("someone");
}
