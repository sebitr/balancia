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
    ["BOOKING.COM", "lodging"],
    ["AIRBNB", "lodging"],
    ["EASYJET", "travel"],
    ["SWISSCOM", "utilities"],
    ["EDF", "utilities"],
    ["ZOOPLUS", "pets"],
    ["ZALANDO", "shopping"],
    ["IKEA 0815", "household"],
    ["LEROY MERLIN", "household"],
    ["EUROPAPARK", "activities"],
    ["GETYOURGUIDE", "activities"],
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
    ["Ice cream at the lake", "restaurants"],
    ["Glaces au bord du lac", "restaurants"],
    ["Glace italienne", "restaurants"],
    ["Apéro chez nous", "restaurants"],
    ["Nuit d'hôtel à Berne", "lodging"],
    ["Camping pitch", "lodging"],
    ["Location de vacances", "lodging"],
    ["Musée d'art", "activities"],
    ["Forfait de ski", "activities"],
    ["Guided tour", "activities"],
    ["Produits d'entretien", "household"],
    ["Cleaning products", "household"],
    ["Plombier", "household"],
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

  it("reads a Coop store format, and leaves bare Coop alone", () => {
    expect(categoryOf("COOP BAU+HOBBY LAUSANNE")).toBe("household");
    expect(categoryOf("COOP VITALITY")).toBe("health");
    expect(categoryOf("COOP RESTAURANT")).toBe("restaurants");

    // Bare Coop is still a supermarket, a pharmacy and a filling station.
    expect(classify("COOP").decision).not.toBe("auto_assigned");
  });

  it("reads a Migros store format the same way", () => {
    expect(categoryOf("MIGROS DO IT GARDEN")).toBe("household");
    expect(categoryOf("MIGROS RESTAURANT")).toBe("restaurants");
    // The supermarket itself is untouched by any of that.
    expect(categoryOf("MIGROS 1234")).toBe("groceries");
  });

  it("never classifies the payment processor itself", () => {
    expect(classify("PAYPAL *SPOTIFY").category).toBe("subscriptions");
    expect(classify("SQ *CAFE CENTRAL").category).toBe("restaurants");

    // The merchant is extracted even when what is behind it stays uncertain:
    // a bakery is a shop as often as it is somewhere to sit down. Both are
    // offered and neither is applied, which is that sentence as behaviour —
    // the bakery used to be a hint towards restaurants and too weak to put
    // on screen at all, so the answer was a blank field.
    const bakery = classify("SUMUP *BOULANGERIE DUPONT");
    expect(bakery.normalizedMerchant).toBe("boulangerie dupont");
    expect(bakery.decision).toBe("suggested");
    expect([
      bakery.category,
      ...bakery.alternatives.map((alternative) => alternative.category),
    ]).toEqual(expect.arrayContaining(["restaurants", "groceries"]));
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

/**
 * The everyday words people actually type.
 *
 * The seeds began as merchants and formal phrases — `billet de train`,
 * `facture électricité` — which is not how anybody describes a round of drinks
 * to their flatmates. Two in five ordinary descriptions came back with nothing
 * at all, and a blank category field is what the picker was then asked to
 * apologise for.
 */
describe("ordinary descriptions", () => {
  const cases: [string, ExpenseCategory][] = [
    // Drinks and street food, the shape of a shared expense on a day out.
    ["Gaufres", "restaurants"],
    ["Crêpes", "restaurants"],
    ["Churros", "restaurants"],
    ["Barbe à papa", "restaurants"],
    ["Chocolat chaud", "restaurants"],
    ["Bière", "restaurants"],
    ["Coffee", "restaurants"],
    ["Wine", "restaurants"],
    ["Frites", "restaurants"],
    ["Goûter", "restaurants"],
    ["Take away", "restaurants"],
    // Staples, which is what the other half of the food spending is.
    ["Pain", "groceries"],
    ["Lait", "groceries"],
    ["Oeufs", "groceries"],
    ["Fromage", "groceries"],
    ["Légumes", "groceries"],
    ["Pâtes", "groceries"],
    ["Bread", "groceries"],
    ["Milk", "groceries"],
    ["Vegetables", "groceries"],
    // Getting about.
    ["Bus", "transport"],
    ["Métro", "transport"],
    ["Ferry", "transport"],
    ["Vélo", "transport"],
    ["Gasoil", "transport"],
    ["Vignette", "transport"],
    // The flat.
    ["Éponges", "household"],
    ["Sacs poubelle", "household"],
    ["Piles", "household"],
    ["Rideaux", "household"],
    ["Facture de gaz", "utilities"],
    ["Forfait mobile", "utilities"],
    // Out and about.
    ["Plongée", "activities"],
    ["Fleurs", "gifts"],
    ["Nuit d'hôtel", "lodging"],
  ];

  for (const [description, expected] of cases) {
    it(`files "${description}" as ${expected}`, () => {
      expect(categoryOf(description)).toBe(expected);
    });
  }
});

describe("plurals", () => {
  /**
   * Every rule used to need its own plural written in beside it, which is how
   * `Pizza` was recognised and `Pizzas` was not.
   */
  it("reads a plural as the word it is the plural of", () => {
    for (const [singular, plural] of [
      ["Pizza", "Pizzas"],
      ["Burger", "Burgers"],
      ["Sandwich", "Sandwichs"],
      ["Vélo", "Vélos"],
      ["Musée", "Musées"],
      ["Billet de train", "Billets de train"],
    ]) {
      expect(categoryOf(plural)).toBe(categoryOf(singular));
      expect(classify(plural).decision).toBe("auto_assigned");
    }
  });

  it("does not read a singular word that ends in s as a plural", () => {
    // `pass` collapsing to `pas` would match most French sentences.
    expect(categoryOf("Ski pass")).toBe("activities");
    expect(classify("Bus").decision).toBe("auto_assigned");
  });
});

describe("words that belong to two languages", () => {
  /**
   * The cost of teaching the classifier French words for food is that some of
   * them are English words for other things. Each one is named rather than
   * given up, because `pain` and `eau` are too useful to lose.
   */
  it("does not read English pain as French bread", () => {
    expect(categoryOf("Back pain massage")).toBe("health");
    expect(categoryOf("Neck pain physio")).toBe("health");
    expect(categoryOf("Pain")).toBe("groceries");
  });

  it("keeps perfume out of the food shopping", () => {
    expect(categoryOf("Eau de parfum")).toBe("shopping");
    expect(categoryOf("Eau")).toBe("groceries");
  });

  it("tells a water bill from a bottle of water", () => {
    expect(categoryOf("Facture d'eau")).toBe("utilities");
    expect(categoryOf("Bouteilles d'eau")).toBe("groceries");
  });

  it("does not let an ingredient outvote the dish", () => {
    // "sucre" is a grocery; "crêpes au sucre" is not.
    expect(categoryOf("Crêpes au sucre")).toBe("restaurants");
    expect(categoryOf("Pain au chocolat")).toBe("restaurants");
  });

  it("files an outing bought as a present as a present", () => {
    expect(categoryOf("Parapente cadeau Célia")).toBe("gifts");
    expect(categoryOf("Parapente")).toBe("activities");
  });
});

/**
 * Brands, which is how half of what a group buys is actually named.
 *
 * A brand names a *product*, and a product is bought — so `Pepsi` is the
 * shopping and not the bar. What gets ordered is named by the drink or by the
 * place ("bière", "apéro", "au bar"), and that is what keeps a scanned
 * supermarket receipt from reading as a night out because there was a Coke on
 * it.
 */
describe("brands", () => {
  const cases: [string, ExpenseCategory][] = [
    ["Pepsi", "groceries"],
    ["Coca", "groceries"],
    ["Fuze tea", "groceries"],
    ["Ice tea", "groceries"],
    ["Red bull", "groceries"],
    ["Evian", "groceries"],
    ["Haribo", "groceries"],
    ["Nutella", "groceries"],
    ["Toblerone", "groceries"],
    ["Heineken", "groceries"],
    ["Nespresso", "groceries"],
    // Ordered rather than carried home.
    ["Aperol spritz", "restaurants"],
    ["Mojito", "restaurants"],
    ["Bière", "restaurants"],
    // Chains arrive as card descriptors as often as they are typed.
    ["Amorino", "restaurants"],
    ["McDo", "restaurants"],
    ["CB MCDONALDS 12/05", "restaurants"],
    ["Wagamama", "restaurants"],
    ["Sprüngli", "restaurants"],
    ["Dominos", "restaurants"],
  ];

  for (const [description, expected] of cases) {
    it(`files "${description}" as ${expected}`, () => {
      expect(categoryOf(description)).toBe(expected);
    });
  }

  it("keeps a supermarket receipt out of the restaurants", () => {
    // Every line of this is a grocery brand, and one of them is a soft drink.
    const result = classifyTransactionSync({
      description: "Migros",
      receipt: {
        merchant: "MIGROS 1234",
        itemNames: ["Coca cola 1.5L", "Pepsi", "Pain", "Lait", "Haribo"],
      },
    });
    expect(result.category).toBe("groceries");
    expect(result.decision).toBe("auto_assigned");
  });

  it("offers both when the words disagree", () => {
    // The drink says shop and the place says bar; neither gets to decide.
    const result = classify("Pepsi au bar");
    expect(result.decision).toBe("suggested");
    expect([
      result.category,
      ...result.alternatives.map((alternative) => alternative.category),
    ]).toEqual(expect.arrayContaining(["groceries", "restaurants"]));
  });

  /**
   * Names that mean something else more often than they mean the brand. Each
   * was looked at and left out: `Mars` is a month in French, `Paul` is a person
   * in an app whose descriptions are full of people, and `Pret` is `prêt`.
   */
  it("leaves out the brands whose names are ordinary words", () => {
    for (const description of ["Mars", "Paul", "Pret", "Innocent"]) {
      expect(classify(description).decision).toBe("needs_user_input");
    }
  });
});
