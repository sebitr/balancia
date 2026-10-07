import { describe, expect, it } from "vitest";
import { renderNotification } from "@/modules/notifications/render";
import type {
  NotificationEntry,
  NotificationPayload,
  NotificationType,
} from "@/modules/notifications/types";
import en from "../../../messages/en.json";
import { toRecentRow } from "./recent-rows";

/**
 * What Home's "Recent in your groups" says about a notification.
 *
 * The inbox's own wording, through the inbox's own renderer, run against the
 * shipped catalogue — with the one exception the column needs: a reminder is
 * said as who sent it rather than as fifteen words of their message.
 */

const translate = (key: string, values?: Record<string, string | number>) => {
  const template = (en.notifications as Record<string, string>)[key]!;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name]));
};

const reminderFrom = (name: string) =>
  en.notificationsPage.reminderFrom.replace("{name}", name);

function entry(
  type: NotificationType,
  payload: NotificationPayload,
  actorLabel: string | null = "Amélie",
): NotificationEntry {
  return {
    id: "n1",
    groupId: "g1",
    type,
    category: "expenses",
    entityType: "expense",
    entityId: "e1",
    actorLabel,
    payload,
    createdAt: new Date("2026-08-12T10:00:00Z"),
    readAt: null,
  };
}

function rowOf(notification: NotificationEntry) {
  return toRecentRow(
    notification,
    renderNotification(notification, translate, "en"),
    reminderFrom,
  );
}

describe("a row of Recent in your groups", () => {
  it("says what the inbox says, with the figure apart and the group beside it", () => {
    const row = rowOf(
      entry("expense.created", {
        kind: "expense",
        groupName: "Lisbon, March",
        description: "Dinner at Trattoria Il Ponte",
        amount: "12840",
        currency: "EUR",
      }),
    );

    expect(row).toEqual({
      id: "n1",
      type: "expense.created",
      actor: "Amélie",
      groupName: "Lisbon, March",
      sentence: "Amélie added Dinner at Trattoria Il Ponte",
      amount: "€128.40",
      url: "/groups/g1/expenses/e1",
      createdAt: "2026-08-12T10:00:00.000Z",
    });
  });

  /** Nobody did it, so there is no face to draw and no name to put first. */
  it("keeps an automatic entry without an actor", () => {
    const row = rowOf(
      entry(
        "recurring.generated",
        {
          kind: "recurring",
          groupName: "Flat 4B",
          description: "Rent, August",
          amount: "145000",
          currency: "EUR",
        },
        null,
      ),
    );

    expect(row.actor).toBeNull();
    expect(row.sentence).toBe("Rent, August was added automatically");
    expect(row.amount).toBe("€1,450.00");
  });

  it("names who sent a reminder rather than quoting their message", () => {
    const row = rowOf(
      entry(
        "reminder.received",
        {
          kind: "reminder",
          groupName: "Lisbon, March",
          debts: [{ amount: "6220", currency: "CHF" }],
          creditorName: "Ravi",
          message: "Gentle nudge: CHF 62.20 is quietly waiting to reach Ravi.",
        },
        "Ravi",
      ),
    );

    expect(row.sentence).toBe("Ravi sent you a reminder");
    expect(row.sentence).not.toContain("Gentle nudge");
    // The figure stays inside the reminder: it is a debt, and this column's
    // figures are prices, drawn with no tone and no word.
    expect(row.amount).toBeNull();
    expect(row.url).toBe("/groups/g1");
  });

  it("falls back to the push message's title when the sender has no name", () => {
    const row = rowOf(
      entry(
        "reminder.received",
        {
          kind: "reminder",
          groupName: "Lisbon, March",
          debts: [{ amount: "6220", currency: "CHF" }],
          creditorName: "Ravi",
          message: "Gentle nudge.",
        },
        null,
      ),
    );

    // The code and the figure are held together by a no-break space.
    expect(row.sentence).toMatch(/^CHF\s62\.20 from Lisbon, March$/);
  });
});
