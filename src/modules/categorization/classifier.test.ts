import { describe, expect, it } from "vitest";
import { classifyTransactionSync } from "./classifier";
import { THRESHOLDS } from "./confidence";
import { CATEGORY_SEEDS } from "./seeds";
import type { ExpenseCategory, LearnedMerchantMapping } from "./types";

/**
 * End-to-end classification.
 *
 * Every case here is a real descriptor. The point is not that the classifier
 * agrees with these particular answers, but that it only *commits* to one
 * when the evidence justifies committing — and says "ask" the rest of the
 * time.
 */

const classify = (description: string, note?: string) =>
  classifyTransactionSync({ description, note });

const categoryOf = (description: string) => classify(description).category;

describe("merchants", () => {
  const cases: [string, ExpenseCategory][] = [
    ["MIGROS 1234", "groceries"],
    ["CARREFOUR MARKET PARIS", "groceries"],
    ["LIDL 0421", "groceries"],
    ["UBER BV", "transport"],
    ["UBER EATS", "restaurants"],
    ["NETFLIX.COM", "subscriptions"],
    ["SPOTIFY", "subscriptions"],
    ["SBB CFF FFS", "transport"],
    ["SNCF CONNECT", "transport"],
    ["AMAVITA", "health"],
    ["BOOKING.COM", "travel"],
    ["AIRBNB", "travel"],
    ["SWISSCOM", "utilities"],
    ["EDF", "utilities"],
    ["ZOOPLUS", "pets"],
    ["ZALANDO", "shopping"],
    ["TICKETCORNER", "entertainment"],
    ["INTERFLORA", "gifts"],
  ];

  for (const [description, expected] of cases) {
    it(`files ${description} as ${expected}`, () => {
      const result = classify(description);
      expect(result.category).toBe(expected);
      expect(result.decision).toBe("auto_assigned");
    });
  }
});

describe("phrases, in English and in French", () => {
  const cases: [string, ExpenseCategory][] = [
    ["MONTHLY RENT", "housing"],
    ["LOYER AOUT", "housing"],
    ["Weekly groceries", "groceries"],
    ["Courses alimentaires", "groceries"],
    ["Dinner", "restaurants"],
    ["Livraison de repas", "restaurants"],
    ["Train ticket to Bern", "transport"],
    ["Billet de train", "transport"],
    ["Electricity bill", "utilities"],
    ["Facture électricité", "utilities"],
    ["PHARMACIE CENTRALE", "health"],
    ["Dentist appointment", "health"],
    ["CRECHE LES PETITS", "family"],
    ["Cantine scolaire", "family"],
    ["FRAIS BANCAIRES", "fees"],
    ["BANK ACCOUNT FEE", "fees"],
    ["PATHE CINEMA", "entertainment"],
    ["TICKETMASTER CONCERT", "entertainment"],
    ["Vétérinaire", "pets"],
    ["Charity donation", "gifts"],
  ];

  for (const [description, expected] of cases) {
    it(`files "${description}" as ${expected}`, () => {
      expect(categoryOf(description)).toBe(expected);
    });
  }
});

describe("contextual overrides", () => {
  it("separates Apple hardware from Apple subscriptions", () => {
    expect(categoryOf("APPLE STORE GENEVA")).toBe("shopping");
    expect(categoryOf("APPLE.COM/BILL")).toBe("subscriptions");
    expect(categoryOf("APPLE MUSIC")).toBe("subscriptions");
  });

  it("treats Amazon Prime as a subscription and Amazon as a hint", () => {
    const prime = classify("AMAZON PRIME");
    expect(prime.category).toBe("subscriptions");
    expect(prime.decision).toBe("auto_assigned");

    // Amazon Fresh exists, so a bare Amazon charge is never decided.
    const marketplace = classify("AMAZON MARKETPLACE");
    expect(marketplace.category).toBe("shopping");
    expect(marketplace.decision).toBe("suggested");
  });

  it("splits Uber between rides and food", () => {
    expect(categoryOf("UBER BV")).toBe("transport");
    expect(categoryOf("UBER EATS AMSTERDAM")).toBe("restaurants");
  });

  it("only calls a filling station transport when fuel is mentioned", () => {
    expect(categoryOf("SHELL DIESEL")).toBe("transport");
    expect(categoryOf("SHELL ESSENCE")).toBe("transport");
    // A sandwich and a coffee at the same station is not a transport cost.
    expect(classify("SHELL").decision).not.toBe("auto_assigned");
  });

  it("never classifies the payment processor itself", () => {
    expect(classify("PAYPAL *SPOTIFY").category).toBe("subscriptions");
    expect(classify("SQ *CAFE CENTRAL").category).toBe("restaurants");

    // The merchant is extracted even when what is behind it stays uncertain:
    // a bakery is a shop as often as it is somewhere to sit down.
    const bakery = classify("SUMUP *BOULANGERIE DUPONT");
    expect(bakery.normalizedMerchant).toBe("boulangerie dupont");
    expect(bakery.alternatives[0]?.category).toBe("restaurants");
  });
});

describe("ambiguity", () => {
  it("asks rather than guessing when the merchant is opaque", () => {
    const result = classify("PAYPAL *ABCDEF123");
    expect(result.decision).toBe("needs_user_input");
    expect(result.category).toBeUndefined();
    expect(result.confidence).toBeLessThan(THRESHOLDS.suggestMinScore);
  });

  it("suggests rather than deciding when two categories are close", () => {
    // "dinner" says restaurants, "migros" says groceries, and neither is far
    // enough ahead to be applied without asking.
    const result = classify("Dinner at Migros");
    expect(result.decision).toBe("suggested");
    expect(result.category).toBe("restaurants");
    expect(result.alternatives[0]?.category).toBe("groceries");
  });

  it("offers at most three categories", () => {
    const result = classify("Café restaurant bar brasserie marché bio");
    expect(result.alternatives.length).toBeLessThanOrEqual(3);
  });

  it("needs a clear margin, not just a high score", () => {
    const result = classify("Dinner at Migros");
    const best = result.confidence;
    const second = result.alternatives[0]?.confidence ?? 0;
    expect(best).toBeGreaterThanOrEqual(THRESHOLDS.autoAssignMinScore);
    expect(best - second).toBeLessThan(THRESHOLDS.autoAssignMinMargin);
  });

  it("says nothing about an empty description", () => {
    expect(classify("").decision).toBe("needs_user_input");
  });
});

describe("excludes", () => {
  it("does not read a supermarket as a restaurant", () => {
    expect(categoryOf("Supermarket café counter")).toBe("groceries");
  });

  it("does not read a monthly gaming charge as an outing", () => {
    expect(categoryOf("PLAYSTATION monthly subscription")).toBe(
      "subscriptions",
    );
  });
});

describe("other", () => {
  it("has no rules of its own", () => {
    const other = CATEGORY_SEEDS.find((seed) => seed.id === "other");
    expect(Object.values(other?.strongPhrases ?? {}).flat()).toEqual([]);
    expect(other?.weakKeywords).toBeUndefined();
    expect(other?.merchants).toBeUndefined();
  });

  it("never wins on evidence", () => {
    for (const description of ["Other", "Autre", "Miscellaneous", "Divers"]) {
      const result = classifyTransactionSync({ description });
      expect(result.category).not.toBe("other");
      expect(
        result.alternatives.map((alternative) => alternative.category),
      ).not.toContain("other");
    }
  });
});

describe("transaction types", () => {
  it("does not silently file income as spending", () => {
    const result = classifyTransactionSync({
      description: "Remboursement carte MIGROS",
    });
    expect(result.transactionType).toBe("refund");
    // The merchant is recognised, but a refund is not a purchase.
    expect(result.category).toBe("groceries");
    expect(result.decision).toBe("suggested");
  });

  it("reports the type on an ordinary expense too", () => {
    expect(classify("MIGROS 1234").transactionType).toBe("expense");
  });
});

describe("recurring", () => {
  it("leans towards subscriptions without deciding on its own", () => {
    const plain = classifyTransactionSync({
      description: "ACME LTD",
      recurring: true,
    });
    expect(plain.decision).toBe("needs_user_input");

    // With a weak hint as well, the bonus is what tips it into a suggestion.
    const withHint = classifyTransactionSync({
      description: "ACME LTD membership",
      recurring: true,
    });
    expect(withHint.category).toBe("subscriptions");
  });
});

describe("receipts", () => {
  it("uses item names as extra evidence", () => {
    const withoutItems = classifyTransactionSync({
      description: "COOP PRONTO",
    });
    expect(withoutItems.decision).not.toBe("auto_assigned");

    const withFuel = classifyTransactionSync({
      description: "COOP PRONTO",
      receipt: { merchant: "Coop Pronto", itemNames: ["diesel", "unleaded"] },
    });
    expect(withFuel.category).toBe("transport");
  });
});

describe("explanations", () => {
  it("says what it matched", () => {
    const result = classify("PATHE CINEMA");
    expect(result.signals).toContain("phrase:cinema");
    expect(result.normalizedMerchant).toBe("pathe cinema");
  });
});

describe("learned mappings", () => {
  const mapping = (
    overrides: Partial<LearnedMerchantMapping> = {},
  ): LearnedMerchantMapping => ({
    scope: "group",
    rawMerchant: "MIGROS 1234",
    normalizedMerchant: "migros",
    category: "restaurants",
    transactionType: null,
    correctionCount: 1,
    conflictCount: 0,
    ...overrides,
  });

  it("outranks the seed rules", () => {
    const result = classifyTransactionSync(
      { description: "MIGROS 1234" },
      { mappings: [mapping()] },
    );
    expect(result.category).toBe("restaurants");
    expect(result.source).toBe("learned_mapping");
    expect(result.decision).toBe("auto_assigned");
  });

  it("applies to the same shop with a different store number", () => {
    const result = classifyTransactionSync(
      { description: "MIGROS 9987" },
      { mappings: [mapping()] },
    );
    expect(result.category).toBe("restaurants");
  });

  it("keeps the seed answer as a fallback the user can pick", () => {
    const result = classifyTransactionSync(
      { description: "MIGROS 1234" },
      { mappings: [mapping()] },
    );
    expect(result.alternatives[0]?.category).toBe("groceries");
  });

  it("lets the group's mapping win over the user's", () => {
    const result = classifyTransactionSync(
      { description: "MIGROS 1234" },
      {
        mappings: [
          mapping({ scope: "user", category: "shopping" }),
          mapping({ scope: "group", category: "restaurants" }),
        ],
      },
    );
    expect(result.category).toBe("restaurants");
  });

  it("is less certain about a mapping that was recently overwritten", () => {
    const settled = classifyTransactionSync(
      { description: "MIGROS 1234" },
      { mappings: [mapping({ correctionCount: 3 })] },
    );
    const flipped = classifyTransactionSync(
      { description: "MIGROS 1234" },
      { mappings: [mapping({ correctionCount: 1, conflictCount: 2 })] },
    );
    expect(flipped.confidence).toBeLessThan(settled.confidence);
    expect(flipped.category).toBe("restaurants");
  });

  it("does not apply to a merchant it was not taught", () => {
    const result = classifyTransactionSync(
      { description: "CARREFOUR MARKET" },
      { mappings: [mapping()] },
    );
    expect(result.category).toBe("groceries");
    expect(result.source).not.toBe("learned_mapping");
  });
});
