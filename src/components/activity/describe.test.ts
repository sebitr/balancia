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

/**
 * French typography, written plainly: a non-breaking space before `:` and
 * `€` and inside « », and a narrow one between thousands. The catalogue and
 * the number format both set them, and a test that typed them out would carry
 * characters nobody can see.
 */
function typeset(text: string): string {
  return text
    .replace(/ ([:€»])/g, "\u00a0$1")
    .replace(/« /g, "«\u00a0")
    .replace(/(\d) (\d{3})/g, "$1\u202f$2");
}

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

  /**
   * "deleted a repayment" said nothing a reader could use. The service now
   * gives every repayment event its two people, so every one names them.
   */
  it("names the people on an edit, a deletion and a restore too", () => {
    expect(line(repayment({ action: "settlement.updated" }), reader(ADA))).toBe(
      "edited Sam's repayment of €30.00 to Marta",
    );
    expect(
      line(repayment({ action: "settlement.deleted" }), reader(MARTA)),
    ).toBe("deleted Sam's repayment of €30.00 to you");
    expect(
      line(repayment({ action: "settlement.restored" }), reader(SAM)),
    ).toBe("restored your repayment of €30.00 to Marta");
  });

  it("says what an edited repayment was, when the edit moved the figure", () => {
    const edited = repayment(
      { action: "settlement.updated" },
      { amount: "4000", before: { amount: "3000", currency: "EUR" } },
    );

    expect(line(edited, reader(ADA))).toBe(
      "edited Sam's repayment of €40.00 to Marta (was €30.00)",
    );
    expect(line(edited, reader(ADA, "fr"), "fr")).toBe(
      typeset(
        "a modifié le remboursement de 40,00 € versé par Sam à Marta (avant : 30,00 €)",
      ),
    );
  });

  it("does not say it was what it still is", () => {
    const touched = repayment(
      { action: "settlement.updated" },
      { before: { amount: "3000", currency: "EUR" } },
    );

    expect(line(touched, reader(ADA))).toBe(
      "edited Sam's repayment of €30.00 to Marta",
    );
  });

  it("falls back to the plain phrase for an edit it cannot name", () => {
    const old = repayment({
      action: "settlement.deleted",
      metadata: { amount: "3000", currency: "EUR" },
    });

    expect(line(old, reader(ADA))).toBe("deleted a repayment");
  });

  it("says the three of them in French", () => {
    expect(
      line(
        repayment({ action: "settlement.deleted" }),
        reader(MARTA, "fr"),
        "fr",
      ),
    ).toBe(
      typeset(
        "a supprimé le remboursement de 30,00 € qui t’a été versé par Sam",
      ),
    );
    expect(
      line(
        repayment({
          action: "settlement.restored",
          actorLabel: "Sam",
          actorParticipantId: SAM,
        }),
        reader(ADA, "fr"),
        "fr",
      ),
    ).toBe(typeset("a rétabli son remboursement de 30,00 € à Marta"));
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

/** An event with only what a test is about written down. */
function event(
  action: ActivityEntry["action"],
  metadata: Record<string, unknown> | null,
  overrides: Partial<ActivityEntry> = {},
): ActivityEntry {
  return {
    id: "a1",
    action,
    entityType: action.split(".")[0] ?? "expense",
    entityId: "e1",
    metadata,
    actorLabel: "Ada",
    actorType: "user",
    actorParticipantId: ADA,
    createdAt: new Date("2026-09-01T10:00:00Z"),
    ...overrides,
  };
}

/**
 * Turning an expense into a repayment, or back.
 *
 * It is one act and two events — the repayment is created and the expense is
 * deleted, in one transaction — and the feed printed them as an unrelated
 * "recorded a repayment" and "deleted an expense", at one instant, in no
 * particular order. `listGroupActivity` folds the pair into the entry that
 * still stands, carrying the deleted one as `replaces`, and the line says what
 * the entry was and what it is.
 */
describe("a change of type", () => {
  const dinner = {
    action: "expense.deleted" as const,
    entityType: "expense",
    entityId: "e1",
    metadata: {
      description: "Dinner",
      amount: "6000",
      currency: "EUR",
      replacedBy: "s1",
    },
  };

  it("says an expense became a repayment, and between whom", () => {
    const folded = repayment({ replaces: dinner });

    expect(line(folded, reader(ADA))).toBe(
      "turned “Dinner” into Sam's repayment of €30.00 to Marta",
    );
    expect(line(folded, reader(MARTA))).toBe(
      "turned “Dinner” into Sam's repayment of €30.00 to you",
    );
    expect(line(folded, reader(SAM))).toBe(
      "turned “Dinner” into your repayment of €30.00 to Marta",
    );
  });

  it("says it in French, with the entry's name set off", () => {
    const folded = repayment({ replaces: dinner });

    expect(line(folded, reader(ADA, "fr"), "fr")).toBe(
      typeset(
        "a transformé « Dinner » en un remboursement de 30,00 € versé par Sam à Marta",
      ),
    );
    expect(line(folded, reader(MARTA, "fr"), "fr")).toBe(
      typeset(
        "a transformé « Dinner » en un remboursement de 30,00 € qui t’a été versé par Sam",
      ),
    );
  });

  it("says a repayment became an entry, with what it was", () => {
    const folded = event(
      "expense.created",
      { description: "Taxi", amount: "2500", currency: "EUR" },
      {
        replaces: {
          action: "settlement.deleted",
          entityType: "settlement",
          entityId: "s1",
          metadata: { amount: "3000", currency: "EUR", replacedBy: "e1" },
        },
      },
    );

    expect(line(folded, reader(ADA))).toBe(
      "turned a repayment of €30.00 into “Taxi” (€25.00)",
    );
    expect(line(folded, reader(ADA, "fr"), "fr")).toBe(
      typeset("a transformé un remboursement de 30,00 € en « Taxi » (25,00 €)"),
    );
  });

  it("does not call an income an expense", () => {
    const salary = repayment({
      replaces: {
        ...dinner,
        metadata: {
          ...dinner.metadata,
          description: "Salary",
          direction: "in",
        },
      },
    });

    expect(line(salary, reader(ADA))).toContain("“Salary”");
    expect(line(salary, reader(ADA))).not.toContain("expense");
  });

  it("still says it when the two people cannot be named", () => {
    const folded = repayment(
      { replaces: dinner },
      { to: "8f0b6e3c-9a4d-4e0a-b9a1-0000000000ff" },
    );

    expect(line(folded, reader(ADA))).toBe("turned “Dinner” into a repayment");
  });
});

/**
 * An edit says what it changed.
 *
 * The write replaces the whole entry, so "edited an expense: Dinner" was all
 * the log could say of a typo fixed and of a payer swapped alike. The event now
 * records which parts moved and what the figure and the name were.
 */
describe("an edited expense", () => {
  const edit = (
    metadata: Record<string, unknown>,
    overrides: Partial<ActivityEntry> = {},
  ) =>
    event(
      "expense.updated",
      { description: "Dinner", amount: "3600", currency: "EUR", ...metadata },
      overrides,
    );
  const was = { description: "Dinner", amount: "3000", currency: "EUR" };

  it("quotes the figure when the amount is all that moved", () => {
    expect(line(edit({ changed: ["amount"], before: was }), reader(ADA))).toBe(
      "changed the amount of “Dinner” from €30.00 to €36.00",
    );
    expect(
      line(edit({ changed: ["amount"], before: was }), reader(ADA, "fr"), "fr"),
    ).toBe(typeset("a changé le montant de « Dinner » de 30,00 € à 36,00 €"));
  });

  it("says a rename as one, with both names", () => {
    expect(
      line(
        edit({
          description: "Dinner at Luigi's",
          changed: ["description"],
          before: was,
        }),
        reader(ADA),
      ),
    ).toBe("renamed “Dinner” to “Dinner at Luigi's”");
  });

  it("lists what moved when it was several things, in the language's own list", () => {
    const several = edit({
      changed: ["amount", "date", "payers"],
      before: was,
    });

    expect(line(several, { ...reader(ADA), language: "en" })).toBe(
      "edited “Dinner”: the amount, the date, and who paid",
    );
    expect(line(several, { ...reader(ADA, "fr"), language: "fr" }, "fr")).toBe(
      typeset("a modifié « Dinner » : le montant, la date et qui a payé"),
    );
  });

  it("keeps to the plain line, with the amount, for an edit that recorded nothing", () => {
    expect(line(edit({}), reader(ADA))).toBe(
      "edited an expense: Dinner (€36.00)",
    );
    expect(line(edit({ changed: [] }), reader(ADA))).toBe(
      "edited an expense: Dinner (€36.00)",
    );
  });

  it("ignores a field a newer version recorded and this one cannot word", () => {
    expect(line(edit({ changed: ["somethingNew", "date"] }), reader(ADA))).toBe(
      "edited “Dinner”: the date",
    );
  });
});

describe("what an entry came to", () => {
  it("says the amount on an added, deleted and restored expense", () => {
    const meta = { description: "Dinner", amount: "3000", currency: "EUR" };

    expect(line(event("expense.created", meta), reader(ADA))).toBe(
      "added an expense: Dinner (€30.00)",
    );
    expect(line(event("expense.deleted", meta), reader(ADA))).toBe(
      "deleted an expense: Dinner (€30.00)",
    );
    expect(line(event("expense.restored", meta), reader(ADA, "fr"), "fr")).toBe(
      typeset("a rétabli une dépense : Dinner (30,00 €)"),
    );
  });

  it("keeps the description alone when the amount will not read", () => {
    expect(
      line(
        event("expense.created", { description: "Dinner", amount: "x" }),
        reader(ADA),
      ),
    ).toBe("added an expense: Dinner");
  });

  it("calls an income an income", () => {
    const meta = {
      description: "Salary",
      amount: "300000",
      currency: "EUR",
      direction: "in",
    };

    expect(line(event("expense.created", meta), reader(ADA))).toBe(
      "added an income: Salary (€3,000.00)",
    );
    expect(line(event("expense.deleted", meta), reader(ADA, "fr"), "fr")).toBe(
      typeset("a supprimé un revenu : Salary (3 000,00 €)"),
    );
    expect(
      line(
        event("recurring.generated", meta, { actorType: "system" }),
        reader(ADA),
      ),
    ).toBe("added an income automatically: Salary (€3,000.00)");
  });
});

describe("the same action id, said for what it was", () => {
  it("tells pausing a recurring expense from resuming it, by name", () => {
    expect(
      line(
        event("recurring.updated", { description: "Rent", paused: true }),
        reader(ADA),
      ),
    ).toBe("paused a recurring expense: Rent");
    expect(
      line(
        event("recurring.updated", { description: "Rent", paused: false }),
        reader(ADA, "fr"),
        "fr",
      ),
    ).toBe(typeset("a repris une dépense récurrente : Rent"));
  });

  it("still words a pause that never recorded the name", () => {
    expect(
      line(event("recurring.updated", { paused: true }), reader(ADA)),
    ).toBe("paused a recurring expense");
  });

  it("does not say a group was archived when it was taken out of the archive", () => {
    expect(line(event("group.archived", { archived: true }), reader(ADA))).toBe(
      "archived the group",
    );
    expect(
      line(event("group.archived", { archived: false }), reader(ADA)),
    ).toBe("took the group out of the archive");
    expect(
      line(
        event("group.archived", { archived: false }),
        reader(ADA, "fr"),
        "fr",
      ),
    ).toBe("a sorti le groupe des archives");
  });
});

describe("the group's own lines", () => {
  it("names the group it created", () => {
    expect(line(event("group.created", { name: "Lisbon" }), reader(ADA))).toBe(
      "created the group “Lisbon”",
    );
    expect(line(event("group.created", null), reader(ADA))).toBe(
      "created the group",
    );
  });

  it("says a rename as one, and a change of zone as one", () => {
    expect(
      line(
        event("group.updated", {
          name: "Lisbon 2027",
          timezone: "Europe/Paris",
          changed: ["name"],
          previousName: "Lisbon",
        }),
        reader(ADA),
      ),
    ).toBe("renamed the group from “Lisbon” to “Lisbon 2027”");
    expect(
      line(
        event("group.updated", {
          name: "Lisbon",
          timezone: "Europe/Lisbon",
          changed: ["timezone"],
        }),
        reader(ADA),
      ),
    ).toBe("set the group's time zone to Europe/Lisbon");
  });

  it("lists several settings, and falls back for an old save", () => {
    expect(
      line(
        event("group.updated", {
          name: "Lisbon 2027",
          timezone: "Europe/Lisbon",
          changed: ["name", "icon"],
        }),
        { ...reader(ADA), language: "en" },
      ),
    ).toBe("updated the group: the name and the icon");
    expect(line(event("group.updated", { name: "Lisbon" }), reader(ADA))).toBe(
      "updated the group",
    );
  });
});

describe("a person's line", () => {
  it("says a rename as one when the event kept the old name", () => {
    const renamed = event("participant.updated", {
      displayName: "Robert",
      previousName: "Bob",
    });

    expect(line(renamed, reader(ADA))).toBe("renamed Bob to Robert");
    expect(line(renamed, reader(ADA, "fr"), "fr")).toBe(
      "a renommé Bob en Robert",
    );
  });

  it("keeps 'updated their details' for an edit that did not rename", () => {
    expect(
      line(event("participant.updated", { displayName: "Bob" }), reader(ADA)),
    ).toBe("updated Bob's details");
  });

  it("names who was reminded, and says you when it was the reader", () => {
    const reminded = event(
      "reminder.sent",
      { recipient: "Marta" },
      { entityType: "participant", entityId: MARTA },
    );

    expect(line(reminded, reader(ADA))).toBe("sent Marta a reminder");
    expect(line(reminded, reader(MARTA))).toBe("sent you a reminder");
    expect(line(reminded, reader(ADA, "fr"), "fr")).toBe(
      "a envoyé une relance à Marta",
    );
  });

  it("uses the name the group has for them now, not the one the event kept", () => {
    const reminded = event(
      "reminder.sent",
      { recipient: "Marta (old)" },
      { entityType: "participant", entityId: MARTA },
    );

    expect(line(reminded, reader(ADA))).toBe("sent Marta a reminder");
  });
});

describe("an import", () => {
  const run = (metadata: Record<string, unknown>) =>
    event("import.completed", metadata, {
      entityType: "import_run",
      actorType: "user",
    });

  it("says how many entries came in, and from which file", () => {
    expect(
      line(
        run({ fileName: "trip.csv", imported: 42, skipped: 0, failed: 0 }),
        reader(ADA),
      ),
    ).toBe("imported 42 entries from “trip.csv”");
    expect(
      line(run({ fileName: "trip.csv", imported: 1, failed: 0 }), reader(ADA)),
    ).toBe("imported 1 entry from “trip.csv”");
  });

  it("says what could not be imported, and when nothing could", () => {
    expect(
      line(run({ fileName: "trip.csv", imported: 40, failed: 2 }), reader(ADA)),
    ).toBe("imported 40 entries from “trip.csv”, 2 could not be imported");
    expect(
      line(run({ fileName: "trip.csv", imported: 0, failed: 0 }), reader(ADA)),
    ).toBe("imported nothing from “trip.csv”");
  });

  it("says it in French, in agreement", () => {
    expect(
      line(
        run({ fileName: "voyage.csv", imported: 40, failed: 1 }),
        reader(ADA, "fr"),
        "fr",
      ),
    ).toBe(
      typeset(
        "a importé 40 transactions depuis « voyage.csv », 1 n’a pas pu être importée",
      ),
    );
  });

  it("keeps the plain phrase for one that never recorded its file", () => {
    expect(line(run({ imported: 12 }), reader(ADA))).toBe(
      "completed an import",
    );
  });
});

/**
 * Who did it.
 *
 * An event keeps the label its actor had when it was written — the name on
 * their account. The group knows them by the name on their row in it, which
 * is what every other screen prints, and a person whose account had no name at
 * all was "Someone". The feed prints the group's name for them, and the label
 * only when it has no seat to look up.
 */
describe("who did it", () => {
  const t = translator("en");

  it("prefers the name the group has for them to the label the event kept", () => {
    const lunch = event("expense.created", null, {
      actorLabel: "Ada Lovelace-Byron",
    });

    expect(actorOf(lunch, t, NAMES)).toBe("Ada");
    expect(actorOf(lunch, t)).toBe("Ada Lovelace-Byron");
  });

  it("names somebody whose event kept no label at all", () => {
    const nameless = event("expense.created", null, { actorLabel: null });

    expect(actorOf(nameless, t, NAMES)).toBe("Ada");
    expect(actorOf(nameless, t)).toBe("Someone");
  });

  it("names the person who started an import, not the worker that finished it", () => {
    const run = event(
      "import.completed",
      { fileName: "a.csv", imported: 1 },
      { actorLabel: "Import", actorParticipantId: SAM },
    );

    expect(actorOf(run, t, NAMES)).toBe("Sam");
    expect(
      actorOf(
        { ...run, actorParticipantId: null, actorType: "system" },
        t,
        NAMES,
      ),
    ).toBe("Balancia");
    expect(actorOf({ ...run, actorParticipantId: null }, t, NAMES)).toBe(
      "Balancia",
    );
  });

  it("still says Balancia for what the schedule did", () => {
    const generated = event("recurring.generated", null, {
      actorLabel: "Scheduled",
      actorType: "system",
      actorParticipantId: null,
    });

    expect(actorOf(generated, t, NAMES)).toBe("Balancia");
  });
});
