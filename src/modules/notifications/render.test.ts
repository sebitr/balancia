import { describe, expect, it } from "vitest";
import { renderNotification } from "./render";
import type { NotificationEntry, ReminderPayload } from "./types";
import en from "../../../messages/en.json";

/**
 * What a reminder says when it arrives.
 *
 * The sender's own words are the title and are never touched; the line beneath
 * is ours, and is rendered from the facts in the reader's language. These tests
 * run against the shipped catalogue, so the sentence people actually receive is
 * the one being asserted.
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
  it("leads with the sender's own sentence", () => {
    const rendered = renderNotification(
      entry(reminder([{ amount: "2400", currency: "EUR" }])),
      translate,
      "en",
    );

    expect(rendered.title).toBe(
      "Gentle nudge: €24.00 is quietly waiting to reach Seb.",
    );
    expect(rendered.body).toBe(
      "€24.00 from Portugal, March. Tap for the breakdown and settle up.",
    );
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

    expect(rendered.body).toContain("€24.00 and ¥700");
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
    expect(rendered.body.replaceAll(" ", " ")).toContain("KWD 24.000 and ¥700");
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

    expect(rendered.body).toContain("€24.00");
  });
});
