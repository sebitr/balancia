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
 *
 * Every kind splits the same way: the title is the short line that survives a
 * lock screen's truncation, and the body is the sentence. Nothing that only
 * exists in the title may matter, because it is the half that gets cut.
 */

/** Just enough of next-intl's translator to render these strings. */
export type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export interface RenderedNotification {
  readonly title: string;
  /**
   * The whole line, amount included — what a push message says.
   *
   * Composed from the two fields below rather than written separately, so the
   * lock screen and the inbox cannot drift into wording one event two ways.
   */
  readonly body: string;
  /**
   * The sentence without the amount: actor, verb, object.
   *
   * The inbox gives the amount a column of its own, right-aligned against the
   * others, so a list of them can be read down as figures rather than hunted
   * for inside fifteen words of prose. A lock screen has no such column, which
   * is why `body` exists and why this is not simply what every caller gets.
   */
  readonly sentence: string;
  /** The amount as the reader writes it, or null where the event has none. */
  readonly amount: string | null;
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
function debtOf(
  payload: ReminderPayload,
  locale: string,
  amountLocale: string,
): string {
  const stored = payload as StoredReminderPayload;
  const debts =
    stored.debts && stored.debts.length > 0
      ? stored.debts
      : stored.amount !== undefined && stored.currency !== undefined
        ? [{ amount: stored.amount, currency: stored.currency }]
        : [];
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(
    debts.map((debt) =>
      formatMoney(money(BigInt(debt.amount), debt.currency), {
        locale: amountLocale,
      }),
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
    // Settle up: the screen that lists every balance in the group, which is
    // where a payment's consequence is visible. It was `/balances` here for as
    // long as this function has existed, and there has never been a route by
    // that name — every settlement notification opened a 404.
    case "settlement.created":
    case "settlement.updated":
    case "settlement.deleted":
      return `${group}/settle`;
    case "import.completed":
      return `${group}/expenses`;
    // A reminder lands on the reader's own position, which is the thing it is
    // about and the one screen that can do something about it.
    case "reminder.received":
      return group;
  }
}

/**
 * How a sentence and its amount are written as one line.
 *
 * The separator is the same middle dot the expense list and the activity log
 * use between a thing and its price, so a push message reads like the app it
 * came from.
 */
const AMOUNT_SEPARATOR = " · ";

/** Joins the two halves into the `body` a push message sends. */
function line(parts: Omit<RenderedNotification, "body">): RenderedNotification {
  return {
    ...parts,
    body: parts.amount
      ? `${parts.sentence}${AMOUNT_SEPARATOR}${parts.amount}`
      : parts.sentence,
  };
}

export function renderNotification(
  entry: NotificationEntry,
  t: Translate,
  locale: string,
  options: {
    /**
     * The notation the reader writes amounts in, when it is not the one their
     * language implies. Words — the list conjunction above, the sentences
     * themselves — always follow `locale`.
     */
    numberLocale?: string;
    /**
     * The app's name, joined to the titles that are otherwise only a group
     * name. Set on a lock screen, where a bare "Chalet" arrives among cards
     * from every other app and says nothing about which one it came from; left
     * unset in the inbox, where the answer is the page the reader is on.
     *
     * Not a translated string: it is the product's name, and it is the same
     * name in every language.
     */
    brand?: string;
  } = {},
): RenderedNotification {
  const amountLocale = options.numberLocale ?? locale;
  const payload = entry.payload;
  const actor = entry.actorLabel ?? t("someone");
  const url = urlFor(entry);
  const tag = `${entry.entityType}:${entry.entityId ?? entry.groupId}`;

  // The group is the title on every kind but one: it is the context a person
  // needs first when a notification arrives without the app open.
  const title = options.brand
    ? `${payload.groupName} - ${options.brand}`
    : payload.groupName;
  switch (payload.kind) {
    case "expense": {
      const key =
        entry.type === "expense.deleted"
          ? "expenseDeleted"
          : entry.type === "expense.updated"
            ? "expenseUpdated"
            : "expenseCreated";
      return line({
        title,
        sentence: t(key, { actor, description: payload.description }),
        // A deletion names no figure: the expense is gone, and reporting what
        // it used to be worth invites the reader to look for it.
        amount:
          entry.type === "expense.deleted"
            ? null
            : amountOf(payload, amountLocale),
        url,
        tag,
      });
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
      return line({
        title,
        sentence: t(key, { actor, counterpart: payload.counterpartName }),
        amount: amountOf(payload, amountLocale),
        url,
        tag,
      });
    }

    case "recurring":
      return line({
        title,
        sentence: t("recurringGenerated", { description: payload.description }),
        amount: amountOf(payload, amountLocale),
        url,
        tag,
      });

    // Counts, not money. The three figures are the sentence itself, so the
    // amount column beside an import row stays empty.
    case "import":
      return line({
        title,
        sentence: t("importCompleted", {
          imported: payload.imported,
          skipped: payload.skipped,
          failed: payload.failed,
        }),
        amount: null,
        url,
        tag,
      });

    /*
     * The only kind whose title is not the group name, and the only one whose
     * body is not ours to phrase.
     *
     * Someone wrote this sentence and chose to send it, so it is the
     * notification — but a title is one line that gets cut mid-word, and these
     * sentences are written to be read whole. It goes in the body, where a
     * lock screen gives it three or four lines and shows it in full.
     *
     * The title carries what the reader needs before deciding to open
     * anything: how much, and which group. That is also what makes a reminder
     * legible among the notifications either side of it, whose titles are
     * group names too.
     *
     * Nothing is joined onto it. The amount is already in the title, and the
     * inbox draws a reminder as a card rather than as a row with columns.
     */
    case "reminder":
      return line({
        title: t("reminderTitle", {
          amount: debtOf(payload, locale, amountLocale),
          group: payload.groupName,
        }),
        sentence: payload.message,
        amount: null,
        url,
        // One outstanding nudge per group: a second reminder replaces the
        // first on the lock screen rather than stacking beside it.
        tag: `reminder:${entry.groupId}`,
      });
  }
}
