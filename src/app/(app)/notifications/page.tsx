import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  NotificationList,
  type ArchivedRow,
  type InboxRow,
} from "@/components/notifications/notification-list";
import { resolveFormatPreferences } from "@/i18n/preferences";
import { getCurrentUser } from "@/lib/security/actor";
import { listInbox, listQuietGroups } from "@/modules/notifications/service";
import { daySectionOf } from "@/modules/notifications/day";
import {
  renderNotification,
  type Translate,
} from "@/modules/notifications/render";
import type { NotificationEntry } from "@/modules/notifications/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificationsPage");
  return { title: t("metaTitle") };
}

/**
 * The inbox.
 *
 * Rendered on the server through the same renderer the push messages use, so
 * the card on a lock screen and the row in this list can never word the same
 * event differently.
 *
 * Two things are decided here rather than in the browser, and both for the
 * same reason: they need a clock or a time zone, and a value the server did not
 * use would hydrate into a list that disagrees with the markup already on
 * screen. `now` is pinned once and passed down; each row arrives knowing which
 * day heading it belongs under. Everything after that — filtering, folding,
 * which row prints a group chip — is arithmetic the client redoes on its own.
 */
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const [t, locale, preferences] = await Promise.all([
    getTranslations("notifications") as Promise<Translate>,
    getLocale(),
    resolveFormatPreferences(),
  ]);

  const now = new Date();
  const [inbox, quiet] = await Promise.all([
    listInbox(user.userId, { limit: 50, now }),
    listQuietGroups(user.userId, { now }),
  ]);

  /** What the sentence is *about*, where the payload names one. */
  const subjectOf = (entry: NotificationEntry): string | null =>
    "description" in entry.payload ? entry.payload.description : null;

  const render = (entry: NotificationEntry) =>
    renderNotification(entry, t, locale, {
      numberLocale: preferences.numberLocale,
    });

  const items: InboxRow[] = inbox.entries.map((entry) => {
    const rendered = render(entry);
    return {
      id: entry.id,
      type: entry.type,
      groupId: entry.groupId,
      groupName: entry.payload.groupName,
      entityId: entry.entityId,
      actor: entry.actorLabel,
      subject: subjectOf(entry),
      title: rendered.title,
      sentence: rendered.sentence,
      amount: rendered.amount,
      url: rendered.url,
      createdAt: entry.createdAt.toISOString(),
      day: daySectionOf(entry.createdAt, now, preferences.timeZone),
      read: entry.readAt !== null,
    };
  });

  /*
   * An archived row is read, months old, and being shown only so it can be
   * found. It gets the whole line — amount included — because there is no
   * column beside it to put the figure in.
   */
  const archived: ArchivedRow[] = inbox.archived.map((entry) => {
    const rendered = render(entry);
    return {
      id: entry.id,
      groupName: entry.payload.groupName,
      sentence: rendered.body,
      amount: rendered.amount,
      createdAt: entry.createdAt.toISOString(),
      url: rendered.url,
    };
  });

  return (
    <NotificationList
      items={items}
      archived={archived}
      now={now.toISOString()}
      quiet={quiet.map((group) => ({
        groupId: group.groupId,
        groupName: group.groupName,
        snoozedUntil: group.snoozedUntil?.toISOString() ?? null,
      }))}
    />
  );
}
