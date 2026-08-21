import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_IDS,
  LEGACY_CATEGORY_MAP,
  SUBCATEGORY_GROUPS,
  getSubcategories,
  getSubcategoryGroups,
  hasSubcategories,
  isExpenseCategory,
  isLegacyCategory,
  isValidSubcategory,
  normalizeLegacyCategory,
} from "./taxonomy";

/**
 * The vocabulary, and the two rules that hold it together: a subcategory
 * belongs to exactly one parent, and a code that was retired resolves to
 * exactly one replacement.
 */

describe("the categories", () => {
  it("is the fifteen, and nothing that was merged away", () => {
    expect(EXPENSE_CATEGORY_IDS).toHaveLength(15);
    expect(EXPENSE_CATEGORY_IDS).toContain("home");
    expect(EXPENSE_CATEGORY_IDS).toContain("kids_family");

    for (const retired of [
      "housing",
      "utilities",
      "household",
      "travel",
      "family",
    ]) {
      expect(isExpenseCategory(retired)).toBe(false);
      expect(EXPENSE_CATEGORY_IDS).not.toContain(retired);
    }
  });

  it("accepts the codes that survived", () => {
    for (const live of ["groceries", "home", "transport", "other"]) {
      expect(isExpenseCategory(live)).toBe(true);
    }
  });

  it("offers a second level everywhere except `other`", () => {
    for (const category of EXPENSE_CATEGORY_IDS) {
      expect(hasSubcategories(category)).toBe(category !== "other");
    }
    // "Other / Other" is one question asked twice.
    expect(getSubcategories("other")).toEqual([]);
  });

  it("keeps every subcategory unique within its own category", () => {
    for (const category of EXPENSE_CATEGORY_IDS) {
      const leaves = getSubcategories(category);
      expect(new Set(leaves).size).toBe(leaves.length);
    }
  });
});

describe("isValidSubcategory", () => {
  it("accepts a subcategory of the category it belongs to", () => {
    expect(isValidSubcategory("transport", "fuel")).toBe(true);
    expect(isValidSubcategory("home", "electricity")).toBe(true);
  });

  it("refuses one that belongs to a different category", () => {
    expect(isValidSubcategory("restaurants", "fuel")).toBe(false);
    expect(isValidSubcategory("groceries", "electricity")).toBe(false);
  });

  it("treats an absent subcategory as valid, however it is spelled", () => {
    // An expense that has no subcategory is not an expense that failed to
    // have one — every one of these is a complete answer.
    for (const empty of [null, undefined, ""]) {
      expect(isValidSubcategory("transport", empty)).toBe(true);
      expect(isValidSubcategory("other", empty)).toBe(true);
    }
  });

  it("refuses anything hung on a category that is not one", () => {
    // Free text from an import is not a category, so nothing sits under it.
    expect(isValidSubcategory("Chalet fund", "fuel")).toBe(false);
    expect(isValidSubcategory("housing", "rent")).toBe(false);
    expect(isValidSubcategory(null, "fuel")).toBe(false);
  });

  it("does not confuse two categories that share a subcategory's name", () => {
    // `streaming` is both entertainment and a subscription, `clothing` is both
    // shopping and a kids-and-family cost. The pair is the identity.
    expect(isValidSubcategory("subscriptions", "streaming")).toBe(true);
    expect(isValidSubcategory("entertainment", "streaming")).toBe(true);
    expect(isValidSubcategory("groceries", "streaming")).toBe(false);
  });
});

describe("normalizeLegacyCategory", () => {
  it("maps every retired code to its replacement", () => {
    expect(normalizeLegacyCategory("housing")).toBe("home");
    expect(normalizeLegacyCategory("utilities")).toBe("home");
    expect(normalizeLegacyCategory("household")).toBe("home");
    expect(normalizeLegacyCategory("family")).toBe("kids_family");
    // `travel` named an occasion rather than a kind of spending, and nothing
    // in a row says which of transport, lodging or activities it meant.
    expect(normalizeLegacyCategory("travel")).toBe("other");
  });

  it("passes a current code through untouched", () => {
    expect(normalizeLegacyCategory("home")).toBe("home");
    expect(normalizeLegacyCategory("groceries")).toBe("groceries");
  });

  it("declines anything that is not a code at all", () => {
    // An imported label is free text and must not be turned into a category.
    expect(normalizeLegacyCategory("Fournitures ménagères")).toBeNull();
    expect(normalizeLegacyCategory("")).toBeNull();
    expect(normalizeLegacyCategory(null)).toBeNull();
    expect(normalizeLegacyCategory("constructor")).toBeNull();
  });

  it("resolves every retired code to a live one", () => {
    for (const [legacy, replacement] of Object.entries(LEGACY_CATEGORY_MAP)) {
      expect(isLegacyCategory(legacy)).toBe(true);
      expect(isExpenseCategory(replacement)).toBe(true);
    }
  });
});

describe("the picker's groupings", () => {
  it("shelves every one of Home's twenty, `other` aside", () => {
    const groups = getSubcategoryGroups("home");
    expect(groups).not.toBeNull();

    const shelved = groups!.flatMap((group) => group.subcategories);
    const expected = getSubcategories("home").filter(
      (leaf) => leaf !== "other",
    );
    expect([...shelved].sort()).toEqual([...expected].sort());
  });

  it("leaves every other category flat", () => {
    for (const category of EXPENSE_CATEGORY_IDS) {
      if (category === "home") continue;
      expect(getSubcategoryGroups(category)).toBeNull();
    }
  });

  it("only ever shelves real subcategories of the category", () => {
    for (const [category, groups] of Object.entries(SUBCATEGORY_GROUPS)) {
      for (const leaves of Object.values(groups)) {
        for (const leaf of leaves) {
          expect(isValidSubcategory(category, leaf)).toBe(true);
        }
      }
    }
  });
});

describe("the message catalogues", () => {
  /**
   * The taxonomy is the source of truth and the catalogues follow it. A code
   * with no label renders as a raw ID on someone's phone, and a label with no
   * code is a string nothing will ever ask for.
   */
  const catalogues = [
    ["en", en],
    ["fr", fr],
  ] as const;

  for (const [locale, messages] of catalogues) {
    it(`labels every category and subcategory in ${locale}`, () => {
      const categories = messages.expenses.categories as Record<string, string>;
      const subcategories = messages.expenses.subcategories as Record<
        string,
        Record<string, string>
      >;

      expect(Object.keys(categories).sort()).toEqual(
        [...EXPENSE_CATEGORY_IDS].sort(),
      );

      for (const category of EXPENSE_CATEGORY_IDS) {
        expect(categories[category]).toBeTruthy();
        const leaves = getSubcategories(category);
        if (leaves.length === 0) {
          expect(subcategories[category]).toBeUndefined();
          continue;
        }
        expect(Object.keys(subcategories[category]).sort()).toEqual(
          [...leaves].sort(),
        );
      }
    });

    it(`labels every picker grouping in ${locale}`, () => {
      const groups = messages.expenses.categoryGroups as Record<
        string,
        Record<string, string>
      >;
      for (const [category, shelves] of Object.entries(SUBCATEGORY_GROUPS)) {
        expect(Object.keys(groups[category]).sort()).toEqual(
          Object.keys(shelves).sort(),
        );
      }
    });
  }

  it("resolves the same code to each language's own word", () => {
    expect(en.expenses.categories.home).toBe("Home");
    expect(fr.expenses.categories.home).toBe("Maison");
    expect(en.expenses.categories.kids_family).toBe("Kids & Family");
    expect(fr.expenses.categories.kids_family).toBe("Enfants & famille");
    expect(en.expenses.subcategories.home.electricity).toBe("Electricity");
    expect(fr.expenses.subcategories.home.electricity).toBe("Électricité");
  });

  it("keeps no label for a category that no longer exists", () => {
    for (const retired of Object.keys(LEGACY_CATEGORY_MAP)) {
      expect(en.expenses.categories).not.toHaveProperty(retired);
      expect(fr.expenses.categories).not.toHaveProperty(retired);
    }
  });
});

describe("the config is the only list", () => {
  it("derives its ids from itself, in picker order", () => {
    expect(EXPENSE_CATEGORY_IDS).toEqual(Object.keys(EXPENSE_CATEGORIES));
  });
});
