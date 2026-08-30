import { describe, expect, it } from "vitest";
import { classifyTransactionSync } from "./classifier";
import { classifyIncomeSync } from "./income-classifier";
import { INCOME_CATEGORY_SEEDS } from "./income-seeds";
import { INCOME_CATEGORIES, isValidIncomeSubcategory } from "./income-taxonomy";

/**
 * The income classifier.
 *
 * The tests that matter most are the negative ones: an income must not reach
 * an expense category, and a subcategory must not be invented. The rest is
 * the usual "does the rule fire".
 */

const income = (description: string, merchant?: string) =>
  classifyIncomeSync({ description, merchant });

describe("classifying money that came in", () => {
  it("files rent received as rent, not as a housing expense", () => {
    const result = income("Rent received — Rue des Bains 12");
    expect(result.category).toBe("rent");
    expect(result.decision).toBe("auto_assigned");

    // The bug this vocabulary exists to fix: the expense classifier reads the
    // same words as somebody's biggest monthly outgoing.
    const asExpense = classifyTransactionSync({
      description: "Rent received — Rue des Bains 12",
    });
    expect(asExpense.category).toBe("home");
  });

  it("recognises the ordinary incomes", () => {
    expect(income("Deposit returned by the agency").category).toBe("deposits");
    expect(income("Salaire août").category).toBe("earnings");
    expect(income("Remboursement CFF").category).toBe("refunds");
    expect(income("Cagnotte pour le week-end").category).toBe("contributions");
    expect(income("Allocations familiales").category).toBe("benefits");
    expect(income("Dividende UBS").category).toBe("financial");
  });

  it("reads a marketplace brand as a sale, because direction already decided", () => {
    const result = income("Vinted", "VINTED");
    expect(result.category).toBe("sales");
    expect(result.subcategory).toBe("secondhand");

    // The same brand spent is shopping. Neither table sees the other.
    expect(classifyTransactionSync({ merchant: "VINTED" }).category).toBe(
      "shopping",
    );
  });

  it("names a subcategory only when the words did", () => {
    expect(income("Loyer mensuel septembre").subcategory).toBe("monthly_rent");
    expect(income("Caution de location rendue").subcategory).toBe(
      "rental_deposit",
    );

    // `refunds` is settled, which of its five leaves is not.
    const vague = income("Remboursement");
    expect(vague.category).toBe("refunds");
    expect(vague.subcategory).toBeUndefined();
  });

  it("asks rather than guessing when nothing matches", () => {
    const result = income("TR-2291");
    expect(result.category).toBeUndefined();
    expect(result.decision).toBe("needs_user_input");
    expect(result.confidence).toBe(0);
  });

  it("never reaches an expense category", () => {
    const incomeCodes = new Set(Object.keys(INCOME_CATEGORIES));
    for (const description of [
      "Migros",
      "Coop Genève",
      "SBB billet",
      "Netflix",
      "Pharmacie du Molard",
      "Loyer",
      "Rent received",
      "Facture électricité",
    ]) {
      const result = income(description);
      if (result.category) expect(incomeCodes.has(result.category)).toBe(true);
      if (result.subcategory) {
        expect(
          isValidIncomeSubcategory(result.category, result.subcategory),
        ).toBe(true);
      }
    }
  });

  it("suppresses a category's text evidence on an exclude", () => {
    // "rent" leans `rent`, but a refunded overcharge is a refund.
    const result = income("Refund of rent overcharge");
    expect(result.category).toBe("refunds");
  });
});

describe("the income seed table", () => {
  it("names only subcategories its category actually has", () => {
    for (const seed of INCOME_CATEGORY_SEEDS) {
      for (const rule of seed.subcategories ?? []) {
        expect(
          isValidIncomeSubcategory(seed.id, rule.id),
          `${seed.id}/${rule.id}`,
        ).toBe(true);
      }
    }
  });

  it("never claims `other`, which is a fallback and not a match", () => {
    for (const seed of INCOME_CATEGORY_SEEDS) {
      expect(seed.id).not.toBe("other");
      for (const rule of seed.subcategories ?? []) {
        expect(rule.id).not.toBe("other");
      }
    }
  });
});
