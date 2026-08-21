import { describe, expect, it } from "vitest";
import type { ClassificationResult } from "@/modules/categorization";
import {
  categoryShortlist,
  confirmationKey,
  directionOf,
  hasAmount,
  primaryActionKey,
  resetsForType,
  sanitiseAmount,
  summariseSplit,
} from "./entry-logic";

/**
 * Retypes a string one character at a time, the way the field actually fills.
 *
 * Sanitising the finished string is not the same test: every intermediate
 * value is also state the field holds and re-renders, so a rule that only
 * holds for the complete amount would still lose characters while typing.
 */
const type = (keys: string, currency = "CHF"): string =>
  [...keys].reduce((text, key) => sanitiseAmount(text + key, currency), "");

describe("sanitiseAmount", () => {
  it("builds an amount character by character", () => {
    expect(type("8460")).toBe("8460");
    expect(type("84.60")).toBe("84.60");
  });

  it("keeps a point with nothing behind it yet", () => {
    expect(sanitiseAmount("84.", "CHF")).toBe("84.");
  });

  it("turns a leading point into an explicit zero", () => {
    expect(type(".5")).toBe("0.5");
  });

  /** The decimal key is a comma on most of Europe's keyboards. */
  it("takes a comma for the decimal separator", () => {
    expect(sanitiseAmount("84,60", "CHF")).toBe("84.60");
  });

  it("drops anything that is not a digit or a separator", () => {
    expect(sanitiseAmount("CHF 84.60", "CHF")).toBe("84.60");
    expect(sanitiseAmount("-1e5", "CHF")).toBe("15");
  });

  it("refuses a second decimal point", () => {
    expect(type("1.2.3")).toBe("1.23");
  });

  it("stops at the currency's precision", () => {
    expect(type("1.234")).toBe("1.23");
  });

  /**
   * The prototype hardcodes two decimals. Yen has none, and a form that lets
   * someone type ¥1200.50 only fails once the server sees it.
   */
  it("gives a currency with no minor unit no decimal point at all", () => {
    expect(type("1200.50", "JPY")).toBe("120050");
    expect(sanitiseAmount("1200.50", "JPY")).toBe("1200");
  });

  it("allows the third decimal a currency actually has", () => {
    expect(type("1.234", "BHD")).toBe("1.234");
    expect(type("1.2345", "BHD")).toBe("1.234");
  });

  it("caps the whole part", () => {
    expect(type("1234567890")).toBe("12345678");
  });

  it("still allows decimals once the whole part is full", () => {
    expect(type("12345678.90")).toBe("12345678.90");
  });

  it("replaces a lone leading zero rather than growing it", () => {
    expect(type("05")).toBe("5");
    expect(type("0.5")).toBe("0.5");
  });

  it("survives a backspace back to empty", () => {
    expect(sanitiseAmount("84.6", "CHF")).toBe("84.6");
    expect(sanitiseAmount("8", "CHF")).toBe("8");
    expect(sanitiseAmount("", "CHF")).toBe("");
  });
});

describe("hasAmount", () => {
  it("is false for empty, zero and punctuation alone", () => {
    expect(hasAmount("")).toBe(false);
    expect(hasAmount("0")).toBe(false);
    expect(hasAmount("0.00")).toBe(false);
    expect(hasAmount(".")).toBe(false);
  });

  it("is true as soon as there is something to save", () => {
    expect(hasAmount("0.01")).toBe(true);
    expect(hasAmount("84.60")).toBe(true);
  });
});

describe("summariseSplit", () => {
  it("leads with what each person carries on an equal split", () => {
    expect(
      summariseSplit({
        method: "equal",
        participantCount: 3,
        eachFormatted: "28.20",
      }),
    ).toEqual({ key: "equalEach", params: { count: 3, amount: "28.20" } });
  });

  it("names the method on the others", () => {
    expect(summariseSplit({ method: "exact", participantCount: 3 }).key).toBe(
      "exactAmounts",
    );
    expect(
      summariseSplit({ method: "percentage", participantCount: 3 }).key,
    ).toBe("percentages");
    expect(summariseSplit({ method: "shares", participantCount: 3 }).key).toBe(
      "shares",
    );
  });

  it("says so when the split came from the receipt", () => {
    expect(
      summariseSplit({ method: "exact", participantCount: 3, byItem: true })
        .key,
    ).toBe("byItem");
  });

  /** "Mine only" income, and any entry that covers one person. */
  it("does not talk about splitting when there is nobody to split with", () => {
    expect(summariseSplit({ method: "equal", participantCount: 1 }).key).toBe(
      "justOne",
    );
  });

  /**
   * Nobody is not one person. "Nobody else's balance moves" is true of an
   * empty split and tells the reader nothing about why it will not save.
   */
  it("tells an empty split apart from a one-person one", () => {
    expect(summariseSplit({ method: "equal", participantCount: 0 }).key).toBe(
      "nobody",
    );
  });
});

describe("directionOf", () => {
  it("maps the two entry types that reach the ledger", () => {
    expect(directionOf("expense")).toBe("out");
    expect(directionOf("income")).toBe("in");
  });

  it("gives a settlement no direction — it is neither", () => {
    expect(directionOf("settle")).toBeNull();
  });
});

describe("primaryActionKey", () => {
  it("changes with the type and with recurrence", () => {
    expect(primaryActionKey("expense", false)).toBe("addExpense");
    expect(primaryActionKey("expense", true)).toBe("saveRecurringExpense");
    expect(primaryActionKey("income", false)).toBe("addIncome");
    expect(primaryActionKey("income", true)).toBe("saveRecurringIncome");
  });

  it("ignores recurrence on a settlement, which cannot repeat", () => {
    expect(primaryActionKey("settle", false)).toBe("recordPayment");
    expect(primaryActionKey("settle", true)).toBe("recordPayment");
  });
});

describe("confirmationKey", () => {
  it("matches what was actually saved", () => {
    expect(confirmationKey("expense", false)).toBe("expenseAdded");
    expect(confirmationKey("income", false)).toBe("incomeAdded");
    expect(confirmationKey("expense", true)).toBe("recurringSaved");
    expect(confirmationKey("income", true)).toBe("recurringSaved");
    expect(confirmationKey("settle", false)).toBe("paymentRecorded");
  });
});

describe("resetsForType", () => {
  it("keeps a scan only on an expense", () => {
    expect(resetsForType("expense").clearScan).toBe(false);
    expect(resetsForType("income").clearScan).toBe(true);
    expect(resetsForType("settle").clearScan).toBe(true);
  });

  /** A repayment is one movement, in the group's own currency, with no paperwork. */
  it("strips recurrence, files and currency choice from a settlement only", () => {
    expect(resetsForType("settle")).toEqual({
      clearScan: true,
      clearRecurrence: true,
      clearAttachments: true,
      resetCurrency: true,
    });
    expect(resetsForType("income").clearRecurrence).toBe(false);
    expect(resetsForType("income").clearAttachments).toBe(false);
    expect(resetsForType("income").resetCurrency).toBe(false);
  });
});

/**
 * The shortlist over the picker.
 *
 * The heading it carries is a claim about where the chips came from, so what
 * matters in these is not only the order but whether `fromDescription` can end
 * up saying "because it says…" over categories the description never produced.
 */
function classified(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    transactionType: "expense",
    confidence: 0.95,
    decision: "auto_assigned",
    source: "merchant",
    alternatives: [],
    signals: [],
    ...overrides,
  };
}

describe("categoryShortlist", () => {
  it("leads with the detected category, then what the group uses", () => {
    const shortlist = categoryShortlist({
      suggestion: classified({ category: "restaurants" }),
      frequent: ["groceries", "transport", "home"],
    });

    expect(shortlist.categories).toEqual([
      "restaurants",
      "groceries",
      "transport",
    ]);
    expect(shortlist.fromDescription).toBe(true);
  });

  it("falls back to the group's own habit when nothing was detected", () => {
    const shortlist = categoryShortlist({
      suggestion: null,
      frequent: ["groceries", "restaurants", "transport", "home"],
    });

    expect(shortlist.categories).toEqual([
      "groceries",
      "restaurants",
      "transport",
    ]);
    // Nothing was read off the description, so nothing may claim it was.
    expect(shortlist.fromDescription).toBe(false);
  });

  it("offers the runners-up of a guess it was not sure about", () => {
    const shortlist = categoryShortlist({
      suggestion: classified({
        decision: "suggested",
        confidence: 0.68,
        category: "restaurants",
        alternatives: [
          { category: "groceries", confidence: 0.61 },
          // Below the offering threshold: the classifier would not put this
          // one forward itself, so neither does the sheet.
          { category: "shopping", confidence: 0.2 },
        ],
      }),
      frequent: ["transport"],
    });

    expect(shortlist.categories).toEqual([
      "restaurants",
      "groceries",
      "transport",
    ]);
  });

  it("keeps the alternatives of a decided answer out", () => {
    const shortlist = categoryShortlist({
      suggestion: classified({
        category: "restaurants",
        alternatives: [{ category: "groceries", confidence: 0.9 }],
      }),
      frequent: [],
    });

    // It was sure: the runner-up is what it rejected, not a second opinion.
    expect(shortlist.categories).toEqual(["restaurants"]);
  });

  it("never repeats a category between the two sources", () => {
    const shortlist = categoryShortlist({
      suggestion: classified({ category: "groceries" }),
      frequent: ["groceries", "restaurants"],
    });

    expect(shortlist.categories).toEqual(["groceries", "restaurants"]);
  });

  it("has nothing to say about a group with no history and no guess", () => {
    expect(categoryShortlist({ suggestion: null, frequent: [] })).toEqual({
      categories: [],
      fromDescription: false,
    });
  });
});
