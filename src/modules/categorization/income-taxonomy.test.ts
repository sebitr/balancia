import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { EXPENSE_CATEGORY_IDS, isExpenseCategory } from "./taxonomy";
import {
  INCOME_CATEGORIES,
  INCOME_CATEGORY_IDS,
  getIncomeSubcategories,
  hasIncomeSubcategories,
  isIncomeCategory,
  isValidIncomeSubcategory,
} from "./income-taxonomy";
import {
  categoryIdsFor,
  isCategoryFor,
  isValidSubcategoryFor,
  subcategoriesFor,
} from "./vocabulary";

/**
 * The income vocabulary, and the one thing that makes it different from the
 * expense one: it shares a column with it. Every test here is about a code
 * meaning one thing in one direction and something else — or nothing — in the
 * other.
 */

describe("the income categories", () => {
  it("is the nine", () => {
    expect(INCOME_CATEGORY_IDS).toHaveLength(9);
    expect(INCOME_CATEGORY_IDS).toEqual([
      "rent",
      "refunds",
      "deposits",
      "contributions",
      "sales",
      "earnings",
      "benefits",
      "financial",
      "other",
    ]);
  });

  it("has forty-one subcategories, and none under other", () => {
    const total = INCOME_CATEGORY_IDS.reduce(
      (sum, id) => sum + INCOME_CATEGORIES[id].subcategories.length,
      0,
    );
    expect(total).toBe(41);
    expect(hasIncomeSubcategories("other")).toBe(false);
    expect(getIncomeSubcategories("other")).toEqual([]);
  });

  it("names no subcategory twice within one parent", () => {
    for (const id of INCOME_CATEGORY_IDS) {
      const subs = INCOME_CATEGORIES[id].subcategories as readonly string[];
      expect(new Set(subs).size).toBe(subs.length);
    }
  });

  it("holds the pair, not the leaf", () => {
    expect(isValidIncomeSubcategory("rent", "monthly_rent")).toBe(true);
    // `parking` is a rent leaf and nothing else here.
    expect(isValidIncomeSubcategory("earnings", "parking")).toBe(false);
    // Optional everywhere.
    expect(isValidIncomeSubcategory("rent", null)).toBe(true);
    expect(isValidIncomeSubcategory("rent", "")).toBe(true);
    // A code from the other vocabulary is not a category here.
    expect(isValidIncomeSubcategory("groceries", "supermarket")).toBe(false);
  });
});

describe("the two vocabularies sharing one column", () => {
  it("reads `rent` as a category one way and a subcategory the other", () => {
    expect(isIncomeCategory("rent")).toBe(true);
    expect(isExpenseCategory("rent")).toBe(false);
    // The same word, as an expense, is a leaf under `home`.
    expect(isValidSubcategoryFor("out", "home", "rent")).toBe(true);
    expect(isValidSubcategoryFor("in", "home", "rent")).toBe(false);
  });

  it("refuses an expense category on an income and the reverse", () => {
    expect(isCategoryFor("in", "groceries")).toBe(false);
    expect(isCategoryFor("out", "groceries")).toBe(true);
    expect(isCategoryFor("in", "deposits")).toBe(true);
    expect(isCategoryFor("out", "deposits")).toBe(false);
  });

  it("treats a missing direction as spending, like the entry does", () => {
    expect(categoryIdsFor(undefined)).toEqual(EXPENSE_CATEGORY_IDS);
    expect(isCategoryFor(undefined, "groceries")).toBe(true);
  });

  it("hands back an empty second level for a code of the wrong direction", () => {
    // Not a crash: a caller that skipped `isCategoryFor` gets an empty
    // picker rather than an exception.
    expect(subcategoriesFor("in", "groceries")).toEqual([]);
    expect(subcategoriesFor("out", "deposits")).toEqual([]);
    expect(subcategoriesFor("in", "rent")).toContain("monthly_rent");
  });
});

describe("the labels", () => {
  it("resolves every income code in both locales", () => {
    for (const locale of [en, fr]) {
      const categories = locale.expenses.incomeCategories as Record<
        string,
        string
      >;
      const subcategories = locale.expenses.incomeSubcategories as Record<
        string,
        Record<string, string>
      >;

      for (const id of INCOME_CATEGORY_IDS) {
        expect(categories[id], `category ${id}`).toBeTruthy();
        for (const leaf of INCOME_CATEGORIES[id]
          .subcategories as readonly string[]) {
          expect(subcategories[id]?.[leaf], `${id}/${leaf}`).toBeTruthy();
        }
      }
    }
  });

  it("carries no label for a code the vocabulary dropped", () => {
    const codes = Object.keys(en.expenses.incomeCategories);
    expect(codes).toEqual([...INCOME_CATEGORY_IDS]);
  });
});
