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
 * body is the sender's own words, and the only thing taken out of it is the
 * link back to the screen the notification already opens. These tests run
 * against the shipped catalogue, so the sentence people actually receive is
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

/**
 * One wording, two shapes.
 *
 * The inbox gives the amount a column of its own so a screenful of them can be
 * read down as figures; a lock screen has no columns and needs the whole line.
 * Both come out of the same call, which is what stops the two surfaces
 * describing one event differently.
 */
describe("splitting the line for a surface that has a column for the amount", () => {
  const expense: ExpensePayload = {
    kind: "expense",
    groupName: "Chalet",
    description: "Raclette",
    amount: "2500",
    currency: "CHF",
  };

  function expenseEntry(type: NotificationEntry["type"]): NotificationEntry {
    return {
      id: "n3",
      groupId: "g1",
      type,
      category: "expenses",
      entityType: "expense",
      entityId: "e1",
      actorLabel: "Hervé",
      payload: expense,
      createdAt: new Date("2026-08-14T09:00:00Z"),
      readAt: null,
    };
  }

  it("keeps the amount out of the sentence and beside it instead", () => {
    const rendered = renderNotification(
      expenseEntry("expense.created"),
      translate,
      "en",
    );

    expect(rendered.sentence).toBe("Hervé added Raclette");
    // Intl holds the code to its number with a space of its own choosing.
    expect(rendered.amount?.replace(/\s/g, " ")).toBe("CHF 25.00");
  });

  /** The push message is the two halves joined, never a third phrasing. */
  it("writes the whole line into the body a push message sends", () => {
    const rendered = renderNotification(
      expenseEntry("expense.created"),
      translate,
      "en",
    );

    expect(rendered.body).toBe(`${rendered.sentence} · ${rendered.amount}`);
  });

  /**
   * A deleted expense has no figure to report. Naming what it was worth only
   * invites the reader to go looking for something that is not there.
   */
  it("gives a deletion no amount at all", () => {
    const rendered = renderNotification(
      expenseEntry("expense.deleted"),
      translate,
      "en",
    );

    expect(rendered.amount).toBeNull();
    expect(rendered.body).toBe("Hervé deleted Raclette");
  });

  /** A reminder's sentence is the sender's own, and carries no column. */
  it("leaves a reminder's authored message as the whole of it", () => {
    const rendered = renderNotification(
      entry(reminder([{ amount: "2400", currency: "EUR" }])),
      translate,
      "en",
    );

    expect(rendered.amount).toBeNull();
    expect(rendered.sentence).toBe(rendered.body);
  });
});

/**
 * The link the sender's message ends on.
 *
 * A reminder is composed to be handed to a chat app, so the group's address
 * rides on the last line. Arriving as a notification it has made no such
 * journey — the card opens that very group when tapped — and the URL is left
 * standing under two sentences as the only thing on the screen a person has to
 * read past. It comes off here, which is also what cleans up every reminder
 * already stored with one.
 */
describe("a reminder that ends on a link home", () => {
  const withLink = (message: string): ReminderPayload => ({
    ...reminder([{ amount: "2400", currency: "EUR" }]),
    message,
  });

  it("drops the address of the screen it already opens", () => {
    const rendered = renderNotification(
      entry(
        withLink(
          "Scientific fact: settling is quick.\nhttps://balancia.app/groups/g1",
        ),
      ),
      translate,
      "en",
    );

    expect(rendered.sentence).toBe("Scientific fact: settling is quick.");
    expect(rendered.body).toBe("Scientific fact: settling is quick.");
  });

  it("drops it written as a path, the way the composer writes it", () => {
    const rendered = renderNotification(
      entry(withLink("Still open.\n/groups/g1")),
      translate,
      "en",
    );

    expect(rendered.sentence).toBe("Still open.");
  });

  /** Somebody else's link is something the sender chose to say. */
  it("keeps a link that points somewhere else", () => {
    const message = "The receipt is here.\nhttps://example.com/receipt.pdf";
    const rendered = renderNotification(
      entry(withLink(message)),
      translate,
      "en",
    );

    expect(rendered.sentence).toBe(message);
  });

  /** A message that is only a link still has to say something. */
  it("keeps it when the link is the whole message", () => {
    const rendered = renderNotification(
      entry(withLink("https://balancia.app/groups/g1")),
      translate,
      "en",
    );

    expect(rendered.sentence).toBe("https://balancia.app/groups/g1");
  });
});

/**
 * Where a settlement lands.
 *
 * `/balances` is not a route and never has been, so every payment notification
 * opened a 404 on a screen that says nothing went wrong.
 */
describe("the destination of a payment notification", () => {
  it("opens the screen that lists the balances", () => {
    const rendered = renderNotification(
      {
        id: "n4",
        groupId: "g1",
        type: "settlement.created",
        category: "settlements",
        entityType: "settlement",
        entityId: "s1",
        actorLabel: "Alice",
        payload: {
          kind: "settlement",
          groupName: "Chalet",
          amount: "12000",
          currency: "CHF",
          direction: "incoming",
          counterpartName: "Alice",
        },
        createdAt: new Date("2026-08-14T09:00:00Z"),
        readAt: null,
      },
      translate,
      "en",
    );

    expect(rendered.url).toBe("/groups/g1/settle");
  });
});
