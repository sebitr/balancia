import { describe, expect, it } from "vitest";
import { foldConversions } from "./fold";
import type { ActivityEntry } from "./service";

/**
 * A change of type is one act and two events. The log writes the new entry and
 * deletes the old one in one transaction, so both carry one instant — and
 * listed as written they were an unrelated repayment and an unrelated deletion,
 * in whichever order the database returned them.
 */

const AT = new Date("2026-10-07T15:24:37.900Z");

function entry(
  id: string,
  action: ActivityEntry["action"],
  entityId: string,
  overrides: Partial<ActivityEntry> = {},
): ActivityEntry {
  return {
    id,
    action,
    entityType: action.split(".")[0] ?? "expense",
    entityId,
    metadata: {},
    actorLabel: "Ada",
    actorType: "user",
    actorParticipantId: "p-ada",
    createdAt: AT,
    ...overrides,
  };
}

describe("a change of type", () => {
  it("folds the deletion into the creation it names", () => {
    const repayment = entry("e-2", "settlement.created", "s1");
    const deletion = entry("e-1", "expense.deleted", "x1", {
      metadata: { description: "Dinner", replacedBy: "s1" },
    });

    const folded = foldConversions([deletion, repayment]);

    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({
      id: "e-2",
      action: "settlement.created",
      replaces: {
        action: "expense.deleted",
        entityType: "expense",
        entityId: "x1",
        metadata: { description: "Dinner", replacedBy: "s1" },
      },
    });
  });

  it("reads the same whichever of the two the database listed first", () => {
    const repayment = entry("e-2", "settlement.created", "s1");
    const deletion = entry("e-1", "expense.deleted", "x1", {
      metadata: { replacedBy: "s1" },
    });

    expect(foldConversions([repayment, deletion])).toEqual(
      foldConversions([deletion, repayment]),
    );
  });

  it("folds a repayment that became an expense, too", () => {
    const expense = entry("e-2", "expense.created", "x1", {
      metadata: { description: "Taxi" },
    });
    const deletion = entry("e-1", "settlement.deleted", "s1", {
      metadata: { replacedBy: "x1" },
    });

    const [folded] = foldConversions([deletion, expense]);

    expect(folded?.action).toBe("expense.created");
    expect(folded?.replaces?.entityType).toBe("settlement");
  });

  it("leaves every other event where it was, in order", () => {
    const before = entry("e-0", "expense.created", "x9", {
      createdAt: new Date("2026-10-06T10:00:00Z"),
    });
    const after = entry("e-9", "member.added", "p2", {
      createdAt: new Date("2026-10-08T10:00:00Z"),
    });
    const repayment = entry("e-2", "settlement.created", "s1");
    const deletion = entry("e-1", "expense.deleted", "x1", {
      metadata: { replacedBy: "s1" },
    });

    const folded = foldConversions([after, deletion, repayment, before]);

    expect(folded.map((row) => row.id)).toEqual(["e-9", "e-2", "e-0"]);
  });

  it("leaves a half alone when its partner is not on the page", () => {
    const deletion = entry("e-1", "expense.deleted", "x1", {
      metadata: { replacedBy: "s1" },
    });
    const repayment = entry("e-2", "settlement.created", "s1");

    expect(foldConversions([deletion])).toEqual([deletion]);
    expect(foldConversions([repayment])).toEqual([repayment]);
  });

  it("does not fold two entries of the same kind", () => {
    // A replacement is always the other kind: an expense that became an
    // expense is an edit, which updates in place.
    const created = entry("e-2", "expense.created", "x2");
    const deletion = entry("e-1", "expense.deleted", "x1", {
      metadata: { replacedBy: "x2" },
    });

    expect(foldConversions([deletion, created])).toHaveLength(2);
  });

  it("does not fold a plain deletion into a creation it never named", () => {
    const repayment = entry("e-2", "settlement.created", "s1", {
      actorParticipantId: "p-bob",
      actorLabel: "Bob",
    });
    const deletion = entry("e-1", "expense.deleted", "x1");

    // Same instant, other kind — but another person did it.
    expect(foldConversions([deletion, repayment])).toHaveLength(2);
  });
});

/**
 * Conversions from before `replacedBy` was recorded name nothing, and are
 * paired on evidence instead: the same person, the same instant, the other kind
 * of entry, and no second candidate on either side.
 */
describe("a change of type written before the deletion named its replacement", () => {
  it("folds the pair the evidence points to", () => {
    const repayment = entry("e-2", "settlement.created", "s1");
    const deletion = entry("e-1", "expense.deleted", "x1");

    const folded = foldConversions([deletion, repayment]);

    expect(folded).toHaveLength(1);
    expect(folded[0]?.replaces?.entityId).toBe("x1");
  });

  it("does not fold when the instants differ", () => {
    const repayment = entry("e-2", "settlement.created", "s1", {
      createdAt: new Date(AT.getTime() + 1),
    });
    const deletion = entry("e-1", "expense.deleted", "x1");

    expect(foldConversions([deletion, repayment])).toHaveLength(2);
  });

  it("does not fold when more than one creation could be the one", () => {
    const first = entry("e-2", "settlement.created", "s1");
    const second = entry("e-3", "settlement.created", "s2");
    const deletion = entry("e-1", "expense.deleted", "x1");

    expect(foldConversions([deletion, first, second])).toHaveLength(3);
  });

  it("does not fold when more than one deletion could be the one", () => {
    const repayment = entry("e-3", "settlement.created", "s1");
    const first = entry("e-1", "expense.deleted", "x1");
    const second = entry("e-2", "expense.deleted", "x2");

    expect(foldConversions([first, second, repayment])).toHaveLength(3);
  });

  it("matches two people who recorded no seat by their label", () => {
    const seatless = { actorParticipantId: null, actorLabel: "Ada" };
    const repayment = entry("e-2", "settlement.created", "s1", seatless);
    const deletion = entry("e-1", "expense.deleted", "x1", seatless);

    expect(foldConversions([deletion, repayment])).toHaveLength(1);
  });
});
