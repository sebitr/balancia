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
  /**
   * A leaf that is precise enough carries both levels. Splitwise's
   * "Electricity" is not merely `home`, it is `home / electricity`, and
   * dropping the second half would throw away something the file said.
   */
  const cases: [string, string, string | null][] = [
    ["Groceries", "groceries", "supermarket"],
    ["Dining out", "restaurants", "restaurant"],
    ["Liquor", "restaurants", "bar"],
    ["Household supplies", "home", "household_supplies"],
    ["Furniture", "home", "furniture"],
    ["Rent", "home", "rent"],
    ["Mortgage", "home", "mortgage"],
    ["Hotel", "lodging", "hotel"],
    ["Plane", "transport", "flights"],
    ["Bus/train", "transport", "public_transport"],
    ["Gas/fuel", "transport", "fuel"],
    ["TV/Phone/Internet", "home", "internet"],
    ["Sports", "activities", "sports"],
    ["Childcare", "kids_family", "childcare"],
    ["Education", "education", "school"],
    ["Taxes", "finance_admin", "taxes"],
    // Vague leaves map to the category alone. "Medical expenses" could be a
    // dentist, a prescription or a premium, and the row does not say which.
    ["Medical expenses", "health", null],
    ["Services", "home", null],
    ["Car", "transport", null],
  ];

  for (const [label, category, subcategory] of cases) {
    it(`reads "${label}" as ${category}${subcategory ? ` / ${subcategory}` : ""}`, () => {
      expect(sourceCategory(label)).toEqual({ category, subcategory });
    });
  }

  it("reads a localised export the same way", () => {
    expect(sourceCategory("Courses")).toEqual({
      category: "groceries",
      subcategory: "supermarket",
    });
    expect(sourceCategory("Fournitures ménagères")).toEqual({
      category: "home",
      subcategory: "household_supplies",
    });
    expect(sourceCategory("Frais médicaux")).toEqual({
      category: "health",
      subcategory: null,
    });
    expect(sourceCategory("Essence/carburant")).toEqual({
      category: "transport",
      subcategory: "fuel",
    });
    expect(sourceCategory("Électricité")).toEqual({
      category: "home",
      subcategory: "electricity",
    });
  });

  it("lets one of our own codes through unchanged", () => {
    expect(sourceCategory("groceries")).toEqual({
      category: "groceries",
      subcategory: null,
    });
    expect(sourceCategory("Lodging")).toEqual({
      category: "lodging",
      subcategory: null,
    });
  });

  it("translates a code an older Balancia wrote", () => {
    // A backup taken before the merge still says `housing`. It is our own
    // code, just a retired one, so it is migrated rather than read as
    // somebody else's label — the same mapping the SQL migration applies.
    for (const legacy of ["housing", "utilities", "household"]) {
      expect(sourceCategory(legacy)).toEqual({
        category: "home",
        subcategory: null,
      });
    }
    expect(sourceCategory("family")).toEqual({
      category: "kids_family",
      subcategory: null,
    });
    expect(sourceCategory("travel")).toEqual({
      category: "other",
      subcategory: null,
    });
  });

  it("keeps a code that a Splitwise group name also spells", () => {
    // "Entertainment" and "Utilities" are Splitwise groups too, and a group is
    // worth less than a description. Written exactly as we write a code, it
    // came out of a Balancia export instead, and a restore must hand back the
    // category it was given.
    expect(sourceCategory("entertainment")).toEqual({
      category: "entertainment",
      subcategory: null,
    });
    // Splitwise's own capitalisation is still read as the group it is.
    expect(sourceCategory("Entertainment")).toBeNull();
    expect(sourceCategory("Utilities")).toBeNull();
    // `insurance` is a code of ours now, but Splitwise's "Insurance" is a
    // group whose leaves scatter across every policy there is. It waits
    // behind the description for the same reason the other two do.
    expect(sourceCategory("Insurance")).toBeNull();
    expect(sourceCategory("Assurances")).toBeNull();
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
    expect(
      categorizeImportedExpense(
        expense({ description: "Dinner shopping", category: "Groceries" }),
      ),
    ).toEqual({ category: "groceries", subcategory: "supermarket" });
  });

  it("classifies from the description when the label says nothing", () => {
    // The classifier names the subcategory here too, because the merchant
    // does: Migros is a supermarket beyond argument.
    expect(
      categorizeImportedExpense(
        expense({ description: "MIGROS 1234", category: "General" }),
      ),
    ).toEqual({ category: "groceries", subcategory: "supermarket" });

    expect(
      categorizeImportedExpense(
        expense({ description: "Nuit d'hôtel à Berne", category: null }),
      ),
    ).toEqual({ category: "lodging", subcategory: "hotel" });
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
    ).toEqual({ category: null, subcategory: null });
    // The mapping taught a category and no child, so no child comes back.
    expect(
      categorizeImportedExpense(expense({ description: "Atelier Ramuz" }), {
        mappings,
      }),
    ).toEqual({ category: "restaurants", subcategory: null });
  });

  it("does not decide what the form would have asked about", () => {
    // Two categories within a hair of each other: an unattended import is
    // exactly the wrong place to pick one.
    expect(
      categorizeImportedExpense(expense({ description: "Dinner at Migros" })),
    ).toEqual({ category: null, subcategory: null });
  });

  it("keeps an unrecognised label rather than losing it", () => {
    expect(
      categorizeImportedExpense(
        expense({ description: "Weekend", category: "Chalet fund" }),
      ),
      // Free text is not a category, so nothing can sit under it.
    ).toEqual({ category: "Chalet fund", subcategory: null });
  });

  it("leaves a row with nothing to go on uncategorised", () => {
    expect(
      categorizeImportedExpense(expense({ description: "Stuff" })),
    ).toEqual({ category: null, subcategory: null });
  });

  it("never files income as spending", () => {
    // The merchant is recognisable, but the row is money coming back.
    expect(
      categorizeImportedExpense(
        expense({ description: "Remboursement carte MIGROS" }),
      ),
    ).toEqual({ category: null, subcategory: null });
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
      // The category is beyond doubt; which kind of lodging is not, and no
      // rule claims to know from a hotel's name alone.
    ).toEqual({ category: "lodging", subcategory: null });

    expect(
      categorizeImportedExpense(
        expense({ description: "Museum tickets", category: "Entertainment" }),
      ),
    ).toEqual({ category: "activities", subcategory: null });
  });

  it("falls back to it when the description says nothing", () => {
    expect(
      categorizeImportedExpense(
        expense({ description: "Getting around", category: "Transportation" }),
      ),
    ).toEqual({ category: "transport", subcategory: null });
  });

  it("leaves a group whose leaves scatter as it found it", () => {
    // "Food and drink" is half a supermarket and half a restaurant: reducing
    // it to either would be inventing an answer nobody gave.
    expect(
      categorizeImportedExpense(
        expense({ description: "Bits and pieces", category: "Food and drink" }),
      ),
    ).toEqual({ category: "Food and drink", subcategory: null });
  });
});

describe("a real export, end to end", () => {
  /** Parsed the way the importer parses it: adapter first, then categorizer. */
  const categorize = (
    fixture: string,
  ): Record<
    string,
    { category: string | null; subcategory: string | null }
  > => {
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

  const pair = (
    category: string | null,
    subcategory: string | null = null,
  ) => ({
    category,
    subcategory,
  });

  it("categorizes an English export", () => {
    expect(categorize("trip-group.csv")).toEqual({
      // "Food and drink" covers both, so the description is what decides.
      // These two come from the description rather than a leaf, and a
      // description that says only "Groceries" names no subcategory. "Taxi"
      // does — the word is the rule.
      Groceries: pair("groceries"),
      Dinner: pair("restaurants"),
      Taxi: pair("transport", "taxi_ride_hailing"),
      "Museum tickets": pair("activities"),
    });
  });

  it("categorizes a French export", () => {
    expect(categorize("groupe-fr.csv")).toEqual({
      // "Entretien" is Splitwise's own word, and Hornbach agrees with it.
      Hornbach: pair("home", "maintenance"),
      "Décompte Electricite 25": pair("home", "electricity"),
      "parapente cadeau célia": pair("gifts_donations"),
      // "Général" says nothing, and neither of these descriptions says more.
      Revolu: pair(null),
      "Barre de son": pair(null),
    });
  });
});

describe("a backup written by an older Balancia", () => {
  /**
   * Self-hosted instances upgrade from whatever they were running, and a
   * backup taken before the merge still names codes that no longer exist.
   * Restoring one must not leave a group full of categories the picker cannot
   * show and no rule will ever match again.
   */
  it("migrates the retired codes it names", () => {
    expect(categorizeImportedExpense(expense({ category: "travel" }))).toEqual({
      category: "other",
      subcategory: null,
    });

    expect(
      categorizeImportedExpense(
        expense({ description: "Loyer août", category: "housing" }),
      ),
    ).toEqual({ category: "home", subcategory: null });

    expect(
      categorizeImportedExpense(
        expense({ description: "Crèche", category: "family" }),
      ),
    ).toEqual({ category: "kids_family", subcategory: null });
  });

  it("restores a pair the user actually chose", () => {
    // Their own answer comes back as their own answer, not as a fresh reading
    // of the description.
    expect(
      categorizeImportedExpense(
        expense({
          description: "Dinner shopping",
          category: "transport",
          subcategory: "fuel",
        }),
      ),
    ).toEqual({ category: "transport", subcategory: "fuel" });
  });

  it("drops a child that does not survive its parent's migration", () => {
    // Nothing guarantees a subcategory learned under `housing` means anything
    // under the code it migrated to.
    expect(
      categorizeImportedExpense(
        expense({ category: "housing", subcategory: "not_a_real_leaf" }),
      ),
    ).toEqual({ category: "home", subcategory: null });
  });

  it("migrates the two codes the taxonomy renamed", () => {
    expect(
      categorizeImportedExpense(
        expense({ category: "fees", subcategory: "bank_fees" }),
      ),
    ).toEqual({ category: "finance_admin", subcategory: "bank_fees" });

    expect(
      categorizeImportedExpense(
        expense({ category: "gifts", subcategory: "weddings" }),
      ),
    ).toEqual({ category: "gifts_donations", subcategory: "weddings" });
  });

  it("follows a subcategory that changed parent, and takes the parent with it", () => {
    // A backup written before `insurance` existed says `health` /
    // `health_insurance`. Restoring it must give back the answer the user
    // gave, which lives somewhere else now — not a fresh reading of the
    // description, and not the bare parent.
    expect(
      categorizeImportedExpense(
        expense({
          description: "Prime CSS",
          category: "health",
          subcategory: "health_insurance",
        }),
      ),
    ).toEqual({ category: "insurance", subcategory: "health" });

    expect(
      categorizeImportedExpense(
        expense({ category: "kids_family", subcategory: "school" }),
      ),
    ).toEqual({ category: "education", subcategory: "school" });

    expect(
      categorizeImportedExpense(
        expense({ category: "entertainment", subcategory: "streaming" }),
      ),
    ).toEqual({ category: "subscriptions", subcategory: "streaming" });
  });

  it("keeps the parent when a subcategory has no successor", () => {
    expect(
      categorizeImportedExpense(
        expense({ category: "fees", subcategory: "late_fees" }),
      ),
    ).toEqual({ category: "finance_admin", subcategory: null });
  });
});
