import { describe, expect, it } from "vitest";
import { createTranslator } from "use-intl/core";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import type { ActivityEntry } from "@/modules/activity/service";
import {
  actorOf,
  describeActivity,
  type ActivityReader,
  type ActivityTranslate,
} from "./describe";

/**
 * The words of an activity line, against the real catalogues.
 *
 * A recorded repayment used to read "recorded a repayment" and nothing else,
 * beside "added an expense: Groceries". The event has always stored who paid,
 * who was paid and how much, so the line says them — with "you" where the
 * reader is one of the two, and "their" where the person who recorded it is
 * the one who paid, since the feed names them just before the line.
 */

const SAM = "8f0b6e3c-9a4d-4e0a-b9a1-000000000001";
const MARTA = "8f0b6e3c-9a4d-4e0a-b9a1-000000000002";
const ADA = "8f0b6e3c-9a4d-4e0a-b9a1-000000000003";

const NAMES = new Map([
  [SAM, "Sam"],
  [MARTA, "Marta"],
  [ADA, "Ada"],
]);

function translator(locale: "en" | "fr") {
  return createTranslator({
    locale,
    messages: locale === "en" ? en : fr,
    namespace: "activity",
  }) as unknown as ActivityTranslate;
}

function repayment(
  overrides: Partial<ActivityEntry> = {},
  metadata: Record<string, unknown> = {},
): ActivityEntry {
  return {
    id: "a1",
    action: "settlement.created",
    entityType: "settlement",
    entityId: "s1",
    metadata: {
      amount: "3000",
      currency: "EUR",
      from: SAM,
      to: MARTA,
      ...metadata,
    },
    actorLabel: "Ada",
    actorType: "user",
    actorParticipantId: ADA,
    createdAt: new Date("2026-09-01T10:00:00Z"),
    ...overrides,
  };
}

function reader(
  you: string | null,
  locale: "en" | "fr" = "en",
): ActivityReader {
  return { you, names: NAMES, locale: locale === "en" ? "en-GB" : "fr-FR" };
}

const line = (
  entry: ActivityEntry,
  as: ActivityReader,
  locale: "en" | "fr" = "en",
) => describeActivity(entry, translator(locale), as);

describe("a recorded repayment", () => {
  it("names who paid whom, and how much", () => {
    expect(line(repayment(), reader(ADA))).toBe(
      "recorded Sam's repayment of €30.00 to Marta",
    );
  });

  it("says you where the reader was paid", () => {
    expect(line(repayment(), reader(MARTA))).toBe(
      "recorded Sam's repayment of €30.00 to you",
    );
  });

  it("says your where the reader paid", () => {
    expect(line(repayment(), reader(SAM))).toBe(
      "recorded your repayment of €30.00 to Marta",
    );
  });

  /** "Sam recorded Sam's repayment" is the sentence this avoids. */
  it("says their when the payer recorded it themselves", () => {
    const own = repayment({ actorLabel: "Sam", actorParticipantId: SAM });

    expect(line(own, reader(ADA))).toBe(
      "recorded their repayment of €30.00 to Marta",
    );
    expect(line(own, reader(MARTA))).toBe(
      "recorded their repayment of €30.00 to you",
    );
    // The feed names the reader in front of the line too, so their own
    // repayment reads "Sam recorded their repayment", not "…your repayment".
    expect(line(own, reader(SAM))).toBe(
      "recorded their repayment of €30.00 to Marta",
    );
  });

  it("says it in French without building a name into a phrase", () => {
    const own = repayment({ actorLabel: "Sam", actorParticipantId: SAM });
    const amount = "30,00 €";

    expect(line(repayment(), reader(ADA, "fr"), "fr")).toBe(
      `a enregistré un remboursement de ${amount} versé par Sam à Marta`,
    );
    expect(line(repayment(), reader(MARTA, "fr"), "fr")).toBe(
      `a enregistré un remboursement de ${amount} qui t’a été versé par Sam`,
    );
    expect(line(repayment(), reader(SAM, "fr"), "fr")).toBe(
      `a enregistré un remboursement de ${amount} que tu as versé à Marta`,
    );
    expect(line(own, reader(ADA, "fr"), "fr")).toBe(
      `a enregistré avoir remboursé ${amount} à Marta`,
    );
    expect(line(own, reader(MARTA, "fr"), "fr")).toBe(
      `a enregistré t’avoir remboursé ${amount}`,
    );
  });

  it("keeps the short line when a name cannot be found", () => {
    const stranger = repayment(
      {},
      { to: "8f0b6e3c-9a4d-4e0a-b9a1-0000000000ff" },
    );

    expect(line(stranger, reader(ADA))).toBe("recorded a repayment");
  });

  it("keeps the short line when the amount will not read", () => {
    expect(line(repayment({}, { amount: 30 }), reader(ADA))).toBe(
      "recorded a repayment",
    );
    expect(line(repayment({}, { currency: "QQQ" }), reader(ADA))).toBe(
      "recorded a repayment",
    );
  });

  it("keeps the short line for an event that never recorded the two people", () => {
    const old = repayment({ metadata: { amount: "3000", currency: "EUR" } });

    expect(line(old, reader(ADA))).toBe("recorded a repayment");
  });

  /** Only creating one stored `from` and `to`; the rest keep their words. */
  it("leaves an edited or deleted repayment as it was", () => {
    expect(
      line(repayment({ action: "settlement.deleted" }), reader(MARTA)),
    ).toBe("deleted a repayment");
  });
});

/**
 * Who a line is about, when nobody typed anything.
 *
 * The scheduler and the import worker store a label where a name goes —
 * "Scheduled", "Import" — and the feed printed it: "Scheduled generated a
 * recurring expense", in French too. The app did that work, so the app is
 * named, in its own words for what it did.
 */
describe("work the app does on its own", () => {
  function event(overrides: Partial<ActivityEntry>): ActivityEntry {
    return {
      id: "a1",
      action: "recurring.generated",
      entityType: "expense",
      entityId: "e1",
      metadata: { description: "Rent", occurrenceDate: "2026-09-01" },
      actorLabel: "Scheduled",
      actorType: "system",
      actorParticipantId: null,
      createdAt: new Date("2026-09-01T10:00:00Z"),
      ...overrides,
    };
  }

  it("names Balancia for an expense a recurring rule added", () => {
    const rent = event({});

    expect(actorOf(rent, translator("en"))).toBe("Balancia");
    expect(line(rent, reader(null))).toBe(
      "added an expense automatically: Rent",
    );
    expect(line(rent, reader(null, "fr"), "fr")).toBe(
      "a ajouté une dépense automatiquement : Rent",
    );
  });

  it("names Balancia for an import, which the worker finishes", () => {
    const run = event({
      action: "import.completed",
      entityType: "import_run",
      actorLabel: "Import",
      actorType: "user",
      metadata: { imported: 12, skipped: 0, failed: 0 },
    });

    expect(actorOf(run, translator("en"))).toBe("Balancia");
    expect(line(run, reader(null))).toBe("completed an import");
  });

  it("still names a person by the name they had", () => {
    const lunch = event({
      action: "expense.created",
      actorLabel: "Ada",
      actorType: "user",
      actorParticipantId: ADA,
    });

    expect(actorOf(lunch, translator("en"))).toBe("Ada");
  });
});

/**
 * Somebody arriving with an account writes `member.added` as their own
 * actor, and its plain phrase made "Ada added someone to the group" of Ada
 * joining. The way they came in says what happened.
 */
describe("somebody joining with an account", () => {
  function joined(metadata: Record<string, unknown> | null): ActivityEntry {
    return {
      id: "a1",
      action: "member.added",
      entityType: "group_member",
      entityId: ADA,
      metadata,
      actorLabel: "Ada",
      actorType: "user",
      actorParticipantId: ADA,
      createdAt: new Date("2026-09-01T10:00:00Z"),
    };
  }

  it("says they joined with the group link", () => {
    expect(line(joined({ via: "join_link", claimed: true }), reader(SAM))).toBe(
      "joined with the group link",
    );
  });

  it("says a guest turned their personal link into an account", () => {
    expect(line(joined({ via: "guest_link" }), reader(SAM))).toBe(
      "turned their personal link into an account",
    );
    expect(line(joined({ via: "guest_link" }), reader(SAM, "fr"), "fr")).toBe(
      "a transformé son lien personnel en compte",
    );
  });

  it("keeps the plain phrase for an event that never said how", () => {
    expect(line(joined(null), reader(SAM))).toBe("added someone to the group");
  });
});
