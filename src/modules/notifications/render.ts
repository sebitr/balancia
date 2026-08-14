import { formatMoney, money } from "@/modules/currencies/money";
import type {
  NotificationEntry,
  NotificationPayload,
  ReminderPayload,
  StoredReminderPayload,
} from "./types";

/**
 * Turns a stored payload into the line someone reads.
 *
 * One renderer serves both surfaces on purpose: a push message and the inbox
 * entry it corresponds to should not be able to drift into saying different
 * things about the same event. The caller supplies the translator, which is
 * how the same row renders in English on the phone and in French in the tab.
 */

/** Just enough of next-intl's translator to render these strings. */
export type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export interface RenderedNotification {
  readonly title: string;
  readonly body: string;
  /** Where tapping it should land. Always a path on this instance. */
  readonly url: string;
  /**
   * Collapse key. Two notifications about the same entity replace one another
   * on the lock screen rather than stacking, so editing an expense three times
   * does not leave three cards.
   */
  readonly tag: string;
}

function amountOf(
  payload: Extract<NotificationPayload, { amount: string }>,
  locale: string,
): string {
  return formatMoney(money(BigInt(payload.amount), payload.currency), {
    locale,
  });
}

/**
 * Every currency a reminder is about, joined the way the reader's language
 * joins a list: "€24.00 and ¥1,400". Two currencies are never added together,
 * so the line names both rather than inventing a total.
 */
function debtOf(payload: ReminderPayload, locale: string): string {
  const stored = payload as StoredReminderPayload;
  const debts =
    stored.debts && stored.debts.length > 0
      ? stored.debts
      : stored.amount !== undefined && stored.currency !== undefined
        ? [{ amount: stored.amount, currency: stored.currency }]
        : [];
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(
    debts.map((debt) =>
      formatMoney(money(BigInt(debt.amount), debt.currency), { locale }),
    ),
  );
}

/**
 * The destination for each kind of event.
 *
 * A deleted expense has no page left to open, so it lands on the list; a
 * settlement lands on the balances screen, which is where its consequence is
 * visible.
 */
function urlFor(entry: NotificationEntry): string {
  const group = `/groups/${entry.groupId}`;
  switch (entry.type) {
    case "expense.created":
    case "expense.updated":
    case "recurring.generated":
      return entry.entityId
        ? `${group}/expenses/${entry.entityId}`
        : `${group}/expenses`;
    case "expense.deleted":
      return `${group}/expenses`;
    case "settlement.created":
    case "settlement.updated":
    case "settlement.deleted":
      return `${group}/balances`;
    case "import.completed":
      return `${group}/expenses`;
    // A reminder lands on the reader's own position, which is the thing it is
    // about and the one screen that can do something about it.
    case "reminder.received":
      return group;
  }
}

export function renderNotification(
  entry: NotificationEntry,
  t: Translate,
  locale: string,
): RenderedNotification {
  const payload = entry.payload;
  const actor = entry.actorLabel ?? t("someone");
  const url = urlFor(entry);
  const tag = `${entry.entityType}:${entry.entityId ?? entry.groupId}`;

  // The group is the title on every kind: it is the context a person needs
  // first when a notification arrives without the app open.
  const title = payload.groupName;

  switch (payload.kind) {
    case "expense": {
      const key =
        entry.type === "expense.deleted"
          ? "expenseDeleted"
          : entry.type === "expense.updated"
            ? "expenseUpdated"
            : "expenseCreated";
      return {
        title,
        body: t(key, {
          actor,
          description: payload.description,
          amount: amountOf(payload, locale),
        }),
        url,
        tag,
      };
    }

    case "settlement": {
      const key =
        entry.type === "settlement.deleted"
          ? "settlementDeleted"
          : entry.type === "settlement.updated"
            ? "settlementUpdated"
            : payload.direction === "incoming"
              ? "settlementIncoming"
              : "settlementOutgoing";
      return {
        title,
        body: t(key, {
          actor,
          amount: amountOf(payload, locale),
          counterpart: payload.counterpartName,
        }),
        url,
        tag,
      };
    }

    case "recurring":
      return {
        title,
        body: t("recurringGenerated", {
          description: payload.description,
          amount: amountOf(payload, locale),
        }),
        url,
        tag,
      };

    case "import":
      return {
        title,
        body: t("importCompleted", {
          imported: payload.imported,
          skipped: payload.skipped,
          failed: payload.failed,
        }),
        url,
        tag,
      };

    /*
     * The only kind whose title is not the group name. Someone wrote this
     * sentence and chose to send it; it is the notification, and burying it
     * under a group name would turn a message into a system event. The line
     * beneath it stays translated, because the facts are ours to phrase.
     */
    case "reminder":
      return {
        title: payload.message,
        body: t("reminderBody", {
          amount: debtOf(payload, locale),
          group: payload.groupName,
        }),
        url,
        // One outstanding nudge per group: a second reminder replaces the
        // first on the lock screen rather than stacking beside it.
        tag: `reminder:${entry.groupId}`,
      };
  }
}
