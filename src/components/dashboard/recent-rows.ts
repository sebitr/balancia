import type { RenderedNotification } from "@/modules/notifications/render";
import type {
  NotificationEntry,
  NotificationType,
} from "@/modules/notifications/types";

/**
 * What Home's "Recent in your groups" column draws, one notification a row.
 *
 * The column is the head of the inbox, not a second feed: the same rows, in
 * the same order, worded by the same `renderNotification` the inbox and a
 * push message use — so a line on Home cannot say something different from
 * the line it opens in Notifications. That is also why it is read from the
 * notifications rather than the activity log. A notification is already
 * about the reader: it leaves out what they did themselves, says "you" where
 * they are one end of a repayment, and is never written for a group they
 * have muted.
 *
 * Plain values only, because the column is a Client Component and this is
 * what the server hands it.
 */
export interface RecentRow {
  readonly id: string;
  readonly type: NotificationType;
  /** Who did it, for the face; null for something Balancia did on its own. */
  readonly actor: string | null;
  readonly groupName: string;
  readonly sentence: string;
  /** The figure the inbox sets in its own column, or null where it has none. */
  readonly amount: string | null;
  readonly url: string;
  readonly createdAt: string;
}

/**
 * How many the column shows: the desktop board's five, which is what fits
 * beside the groups at 1280px without the column outrunning them.
 */
export const RECENT_LIMIT = 5;

/**
 * One notification as a row of the column.
 *
 * Every kind keeps the inbox's sentence but one. A reminder's sentence is the
 * sender's own message, written to be read in full on the card the inbox
 * gives it; out here, in one line beside a group's name, it would be fifteen
 * words of somebody else's prose with nothing saying whose. So the row says
 * who sent it — "Ravi sent you a reminder", the inbox's own heading for the
 * card at this width — and falls back to the push message's title, "€24.00
 * from Flat 4B", where the sender has no name to give.
 */
export function toRecentRow(
  entry: NotificationEntry,
  rendered: RenderedNotification,
  reminderFrom: (name: string) => string,
): RecentRow {
  const sentence =
    entry.type === "reminder.received"
      ? entry.actorLabel
        ? reminderFrom(entry.actorLabel)
        : rendered.title
      : rendered.sentence;

  return {
    id: entry.id,
    type: entry.type,
    actor: entry.actorLabel,
    groupName: entry.payload.groupName,
    sentence,
    amount: rendered.amount,
    url: rendered.url,
    createdAt: entry.createdAt.toISOString(),
  };
}
