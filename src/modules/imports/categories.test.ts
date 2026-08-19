import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LearnedMerchantMapping } from "@/modules/categorization";
import { categorizeImportedExpense, sourceCategory } from "./categories";
import { splitwiseCsvAdapter } from "./splitwise-csv";
import type { StagedExpense } from "./types";

/**
 * Categorizing imported rows.
 *
 * The question every case here asks is the same one the module asks: is this
 * a *translation* of something the source already decided, something the
 * rules can decide on their own, or something to leave exactly as it came?
 */

const expense = (overrides: Partial<StagedExpense> = {}): StagedExpense => ({
  kind: "expense",
  description: "Something",
  category: null,
  date: "2026-03-01",
  amount: "2500",
  currency: "CHF",
  payers: [{ sourceName: "Ada", amount: "2500" }],
  shares: [{ sourceName: "Ada", amount: "2500" }],
  ...overrides,
});

describe("the source's own vocabulary", () => {
  const cases: [string, string][] = [
    ["Groceries", "groceries"],
    ["Dining out", "restaurants"],
    ["Liquor", "restaurants"],
    ["Household supplies", "household"],
    ["Furniture", "household"],
    ["Rent", "housing"],
    ["Mortgage", "housing"],
    ["Hotel", "lodging"],
    ["Plane", "travel"],
    ["Bus/train", "transport"],
    ["Gas/fuel", "transport"],
    ["TV/Phone/Internet", "utilities"],
    ["Medical expenses", "health"],
    ["Childcare", "family"],
    ["Sports", "activities"],
    ["Taxes", "fees"],
  ];

  for (const [label, expected] of cases) {
    it(`reads "${label}" as ${expected}`, () => {
      expect(sourceCategory(label)).toBe(expected);
    });
  }

  it("reads a localised export the same way", () => {
    expect(sourceCategory("Courses")).toBe("groceries");
    expect(sourceCategory("Fournitures ménagères")).toBe("household");
    expect(sourceCategory("Frais médicaux")).toBe("health");
    expect(sourceCategory("Essence/carburant")).toBe("transport");
    expect(sourceCategory("Électricité")).toBe("utilities");
  });

  it("lets one of our own codes through unchanged", () => {
    expect(sourceCategory("groceries")).toBe("groceries");
    expect(sourceCategory("Lodging")).toBe("lodging");
  });

  it("keeps a code that a Splitwise group name also spells", () => {
    // "Entertainment" and "Utilities" are Splitwise groups too, and a group is
    // worth less than a description. Written exactly as we write a code, it
    // came out of a Balancia export instead, and a restore must hand back the
    // category it was given.
    expect(sourceCategory("entertainment")).toBe("entertainment");
    expect(sourceCategory("utilities")).toBe("utilities");
    // Splitwise's own capitalisation is still read as the group it is.
    expect(sourceCategory("Entertainment")).toBeNull();
    expect(sourceCategory("Utilities")).toBeNull();
  });

  it("declines the labels that mean nothing on their own", () => {
    // Splitwise exports the leaf, so "Other" under Home is furniture and
    // "Other" under Life is a dentist. Neither is a translation.
    for (const label of ["General", "Other", "Autre", "", "   ", null]) {
      expect(sourceCategory(label)).toBeNull();
    }
  });

  it("declines a label it has never seen", () => {
    expect(sourceCategory("Chalet fund")).toBeNull();
  });

  it("answers for the table's own entries and nothing else", () => {
    // A label out of a file must not reach Object.prototype.
    expect(sourceCategory("constructor")).toBeNull();
    expect(sourceCategory("toString")).toBeNull();
  });
});

describe("categorizing a row", () => {
  it("prefers the source's label to its own reading of the text", () => {
    // Splitwise says groceries; the word "dinner" says restaurants. The
    // person who filed it at the time is the better witness.
    const category = categorizeImportedExpense(
      expense({ description: "Dinner shopping", category: "Groceries" }),
    );
    expect(category).toBe("groceries");
  });

  it("classifies from the description when the label says nothing", () => {
    expect(
      categorizeImportedExpense(
        expense({ description: "MIGROS 1234", category: "General" }),
      ),
    ).toBe("groceries");

    expect(
      categorizeImportedExpense(
        expense({ description: "Nuit d'hôtel à Berne", category: null }),
      ),
    ).toBe("lodging");
  });

  it("uses what the group already taught the classifier", () => {
    // Stored under the learning key, which is what `recordCategoryChoice`
    // writes: the merchant with store numbers and other noise dropped.
    const mappings: LearnedMerchantMapping[] = [
      {
        scope: "group",
        rawMerchant: "ATELIER RAMUZ",
        normalizedMerchant: "atelier ramuz",
        category: "restaurants",
        transactionType: null,
        correctionCount: 2,
        conflictCount: 0,
      },
    ];

    // No rule in the world knows this name.
    expect(
      categorizeImportedExpense(expense({ description: "Atelier Ramuz" })),
    ).toBeNull();
    expect(
      categorizeImportedExpense(expense({ description: "Atelier Ramuz" }), {
        mappings,
      }),
    ).toBe("restaurants");
  });

  it("does not decide what the form would have asked about", () => {
    // Two categories within a hair of each other: an unattended import is
    // exactly the wrong place to pick one.
    expect(
      categorizeImportedExpense(expense({ description: "Dinner at Migros" })),
    ).toBeNull();
  });

  it("keeps an unrecognised label rather than losing it", () => {
    expect(
      categorizeImportedExpense(
        expense({ description: "Weekend", category: "Chalet fund" }),
      ),
    ).toBe("Chalet fund");
  });

  it("leaves a row with nothing to go on uncategorised", () => {
    expect(
      categorizeImportedExpense(expense({ description: "Stuff" })),
    ).toBeNull();
  });

  it("never files income as spending", () => {
    // The merchant is recognisable, but the row is money coming back.
    expect(
      categorizeImportedExpense(
        expense({ description: "Remboursement carte MIGROS" }),
      ),
    ).toBeNull();
  });
});

describe("a group label rather than a leaf", () => {
  it("lets the description overrule it", () => {
    // Splitwise files hotel nights under Transportation. The description knows
    // better, and a group is not specific enough to argue with it.
    expect(
      categorizeImportedExpense(
        expense({ description: "Hotel Bellevue", category: "Transportation" }),
      ),
    ).toBe("lodging");

    expect(
      categorizeImportedExpense(
        expense({ description: "Museum tickets", category: "Entertainment" }),
      ),
    ).toBe("activities");
  });

  it("falls back to it when the description says nothing", () => {
    expect(
      categorizeImportedExpense(
        expense({ description: "Getting around", category: "Transportation" }),
      ),
    ).toBe("transport");
  });

  it("leaves a group whose leaves scatter as it found it", () => {
    // "Food and drink" is half a supermarket and half a restaurant: reducing
    // it to either would be inventing an answer nobody gave.
    expect(
      categorizeImportedExpense(
        expense({ description: "Bits and pieces", category: "Food and drink" }),
      ),
    ).toBe("Food and drink");
  });
});

describe("a real export, end to end", () => {
  /** Parsed the way the importer parses it: adapter first, then categorizer. */
  const categorize = (fixture: string): Record<string, string | null> => {
    const content = readFileSync(
      path.join(process.cwd(), "tests/fixtures/splitwise", fixture),
      "utf8",
    );
    const parsed = splitwiseCsvAdapter.parse(content);
    return Object.fromEntries(
      parsed.rows
        .filter(({ row }) => row.kind === "expense")
        .map(({ row }) => [
          (row as StagedExpense).description,
          categorizeImportedExpense(row as StagedExpense),
        ]),
    );
  };

  it("categorizes an English export", () => {
    expect(categorize("trip-group.csv")).toEqual({
      // "Food and drink" covers both, so the description is what decides.
      Groceries: "groceries",
      Dinner: "restaurants",
      Taxi: "transport",
      "Museum tickets": "activities",
    });
  });

  it("categorizes a French export", () => {
    expect(categorize("groupe-fr.csv")).toEqual({
      // "Entretien" is Splitwise's own word, and Hornbach agrees with it.
      Hornbach: "household",
      "Décompte Electricite 25": "utilities",
      "parapente cadeau célia": "gifts",
      // "Général" says nothing, and neither of these descriptions says more.
      Revolu: null,
      "Barre de son": null,
    });
  });
});
