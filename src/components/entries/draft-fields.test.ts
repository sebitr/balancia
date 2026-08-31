import { describe, expect, it } from "vitest";
import { draftFields, worthDrafting } from "./draft-fields";

/**
 * A draft sits in the browser for a week, so what comes back is validated
 * rather than trusted: it may name people who have left, and it may predate
 * the version of the form reading it.
 */

const MEMBERS = ["seb", "herve"];

const stored = (overrides: Record<string, unknown> = {}) => ({
  type: "expense",
  amountText: "61.20",
  currency: "CHF",
  description: "Coop Genève",
  notes: "",
  category: "groceries",
  subcategory: "supermarket",
  categoryChosen: true,
  date: "2026-08-31",
  payerId: "seb",
  includedIds: ["seb", "herve"],
  splitMethod: "equal",
  splitValues: {},
  recurrence: { enabled: false },
  attachmentIds: [],
  ...overrides,
});

describe("reading a draft back", () => {
  it("returns the fields it was given", () => {
    const fields = draftFields(stored(), MEMBERS);
    expect(fields?.amountText).toBe("61.20");
    expect(fields?.description).toBe("Coop Genève");
    expect(fields?.category).toBe("groceries");
    expect(fields?.includedIds).toEqual(["seb", "herve"]);
  });

  it("drops a member who has left", () => {
    const fields = draftFields(
      stored({ includedIds: ["seb", "herve", "gone"] }),
      MEMBERS,
    );
    expect(fields?.includedIds).toEqual(["seb", "herve"]);
  });

  it("refuses a draft whose payer has left", () => {
    // Guessing a different payer puts words in somebody's mouth about the one
    // fact people most often need to correct.
    expect(draftFields(stored({ payerId: "gone" }), MEMBERS)).toBeNull();
  });

  it("refuses one with nobody left in the split", () => {
    expect(draftFields(stored({ includedIds: ["gone"] }), MEMBERS)).toBeNull();
  });

  it("refuses a settlement, which has no pair to restore", () => {
    expect(draftFields(stored({ type: "settle" }), MEMBERS)).toBeNull();
  });

  it("refuses anything that is not a draft", () => {
    expect(draftFields(null, MEMBERS)).toBeNull();
    expect(draftFields("61.20", MEMBERS)).toBeNull();
    expect(draftFields({}, MEMBERS)).toBeNull();
  });

  it("falls back rather than trusting a field it cannot read", () => {
    const fields = draftFields(
      stored({ splitMethod: "sideways", amountText: 61.2, categoryChosen: 1 }),
      MEMBERS,
    );
    expect(fields?.splitMethod).toBe("equal");
    expect(fields?.amountText).toBe("");
    expect(fields?.categoryChosen).toBe(false);
  });
});

describe("the recurrence half", () => {
  it("restores a rule that was on", () => {
    const fields = draftFields(
      stored({
        recurrence: {
          enabled: true,
          frequency: "weekly",
          interval: 2,
          weekday: 4,
          dayOfMonth: 1,
          weekOfMonth: null,
          endDate: null,
          count: 12,
        },
      }),
      MEMBERS,
    );
    expect(fields?.recurrence).toMatchObject({
      enabled: true,
      frequency: "weekly",
      interval: 2,
      weekday: 4,
      count: 12,
    });
  });

  it("turns repeats off for anything that is not a rule", () => {
    // The one outcome worth ruling out is silently scheduling something
    // nobody asked for, so only an explicit `enabled: true` turns it on.
    for (const notARule of [undefined, null, "weekly", 3, {}]) {
      expect(
        draftFields(stored({ recurrence: notARule }), MEMBERS)?.recurrence
          .enabled,
        String(notARule),
      ).toBe(false);
    }
    expect(
      draftFields(stored({ recurrence: { enabled: false } }), MEMBERS)
        ?.recurrence.enabled,
    ).toBe(false);
  });

  it("keeps a rule on but falls back on the parts it cannot read", () => {
    const fields = draftFields(
      stored({ recurrence: { enabled: true, frequency: "hourly" } }),
      MEMBERS,
    );
    expect(fields?.recurrence.enabled).toBe(true);
    expect(fields?.recurrence.frequency).toBe("monthly");
  });

  it("clamps a rule's numbers into range", () => {
    const fields = draftFields(
      stored({
        recurrence: {
          enabled: true,
          frequency: "monthly",
          interval: 99,
          weekday: 0,
        },
      }),
      MEMBERS,
    );
    expect(fields?.recurrence.interval).toBe(1);
    expect(fields?.recurrence.weekday).toBe(1);
  });
});

describe("whether there is anything worth keeping", () => {
  it("keeps a typed amount, a description or a file", () => {
    expect(
      worthDrafting({
        amountText: "12",
        description: "",
        attachmentIds: [],
      }),
    ).toBe(true);
    expect(
      worthDrafting({ amountText: "", description: "Coop", attachmentIds: [] }),
    ).toBe(true);
    expect(
      worthDrafting({ amountText: "", description: "", attachmentIds: ["a"] }),
    ).toBe(true);
  });

  it("keeps nothing from an untouched form", () => {
    expect(
      worthDrafting({ amountText: "", description: "", attachmentIds: [] }),
    ).toBe(false);
    // The placeholder the amount field shows is not something somebody typed.
    expect(
      worthDrafting({ amountText: "0.00", description: "", attachmentIds: [] }),
    ).toBe(false);
    expect(
      worthDrafting({ amountText: "  ", description: " ", attachmentIds: [] }),
    ).toBe(false);
  });
});
