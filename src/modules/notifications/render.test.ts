import { describe, expect, it } from "vitest";
import { renderNotification } from "./render";
import type {
  ExpensePayload,
  NotificationEntry,
  ReminderPayload,
} from "./types";
import en from "../../../messages/en.json";

/**
 * What a notification says when it arrives.
 *
 * The facts are the title, rendered in the reader's language; a reminder's
 * body is the sender's own words and is never touched. These tests run against
 * the shipped catalogue, so the sentence people actually receive is the one
 * being asserted.
 */

const translate = (key: string, values?: Record<string, string | number>) => {
  const template = (en.notifications as Record<string, string>)[key];
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name]));
};

function entry(payload: ReminderPayload): NotificationEntry {
  return {
    id: "n1",
    groupId: "g1",
    type: "reminder.received",
    category: "reminders",
    entityType: "participant",
    entityId: "p1",
    actorLabel: "Seb",
    payload,
    createdAt: new Date("2026-08-14T09:00:00Z"),
    readAt: null,
  };
}

function reminder(debts: ReminderPayload["debts"]): ReminderPayload {
  return {
    kind: "reminder",
    groupName: "Portugal, March",
    debts,
    creditorName: "Seb",
    message: "Gentle nudge: €24.00 is quietly waiting to reach Seb.",
  };
}

describe("a reminder arriving", () => {
  /**
   * A title is the half a lock screen cuts mid-word, so the sender's sentence
   * — written to be read whole — goes in the body, and the two facts worth
   * having at a glance go above it.
   */
  it("puts the facts in the title and the sender's sentence in the body", () => {
    const rendered = renderNotification(
      entry(reminder([{ amount: "2400", currency: "EUR" }])),
      translate,
      "en",
    );

    expect(rendered.title).toBe("€24.00 from Portugal, March");
    expect(rendered.body).toBe(
      "Gentle nudge: €24.00 is quietly waiting to reach Seb.",
    );
  });

  /** Nothing the reader needs may live only in the line that gets truncated. */
  it("keeps the title short enough to survive a lock screen", () => {
    const rendered = renderNotification(
      entry(reminder([{ amount: "2400", currency: "EUR" }])),
      translate,
      "en",
    );

    expect(rendered.title.length).toBeLessThan(48);
  });

  /** Two currencies, two figures: there is no rate here to merge them with. */
  it("names every currency the debt is in", () => {
    const rendered = renderNotification(
      entry(
        reminder([
          { amount: "2400", currency: "EUR" },
          { amount: "700", currency: "JPY" },
        ]),
      ),
      translate,
      "en",
    );

    expect(rendered.title).toContain("€24.00 and ¥700");
  });

  /**
   * Each currency keeps its own exponent through the join: yen has no minor
   * unit at all and the dinar has three, and a list is exactly where a shared
   * "two decimal places" assumption would show up.
   */
  it("gives each currency the decimals it actually has", () => {
    const rendered = renderNotification(
      entry(
        reminder([
          { amount: "24000", currency: "KWD" },
          { amount: "700", currency: "JPY" },
        ]),
      ),
      translate,
      "en",
    );

    // Intl holds a currency code to its number with a non-breaking space,
    // which is right on screen and unreadable in an assertion.
    expect(rendered.title.replaceAll(" ", " ")).toContain(
      "KWD 24.000 and ¥700",
    );
  });

  /**
   * Reminders sent before a person's debts were grouped carry a single amount.
   * Those rows are still in inboxes, and must still read as they read then.
   */
  it("still renders a notification written in the old single-amount shape", () => {
    const legacy = {
      kind: "reminder",
      groupName: "Portugal, March",
      amount: "2400",
      currency: "EUR",
      creditorName: "Seb",
      message: "A nudge.",
    } as unknown as ReminderPayload;

    const rendered = renderNotification(entry(legacy), translate, "en");

    expect(rendered.title).toContain("€24.00");
  });
});

/**
 * Where a notification says it came from.
 *
 * The group name alone is the whole title on every kind but a reminder, which
 * is enough inside the app and not enough on a lock screen among cards from
 * every other app on the phone.
 */
describe("naming the app in the title", () => {
  const expense: ExpensePayload = {
    kind: "expense",
    groupName: "Chalet",
    description: "Groceries",
    amount: "2400",
    currency: "EUR",
  };

  const expenseEntry: NotificationEntry = {
    id: "n2",
    groupId: "g1",
    type: "expense.created",
    category: "expenses",
    entityType: "expense",
    entityId: "e1",
    actorLabel: "Seb",
    payload: expense,
    createdAt: new Date("2026-08-14T09:00:00Z"),
    readAt: null,
  };

  it("joins the app's name to the group on a push", () => {
    const rendered = renderNotification(expenseEntry, translate, "en", {
      brand: "Balancia",
    });

    expect(rendered.title).toBe("Chalet - Balancia");
  });

  /** In the inbox the answer to "which app" is the page the reader is on. */
  it("leaves the title as the group name where the app is the context", () => {
    const rendered = renderNotification(expenseEntry, translate, "en");

    expect(rendered.title).toBe("Chalet");
  });

  /**
   * A reminder's title is already a sentence about a debt, not a bare label,
   * so it is the one kind the brand is not welded onto.
   */
  it("leaves a reminder's title alone", () => {
    const rendered = renderNotification(
      entry(reminder([{ amount: "2400", currency: "EUR" }])),
      translate,
      "en",
      { brand: "Balancia" },
    );

    expect(rendered.title).toBe("€24.00 from Portugal, March");
  });
});
