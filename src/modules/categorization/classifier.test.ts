import { describe, expect, it } from "vitest";
import { classifyTransactionSync } from "./classifier";
import { THRESHOLDS } from "./confidence";
import { CATEGORY_SEEDS } from "./seeds";
import { isValidSubcategory } from "./taxonomy";
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
    ["EASYJET", "transport"],
    ["SWISSCOM", "home"],
    ["EDF", "home"],
    ["ZOOPLUS", "pets"],
    ["ZALANDO", "shopping"],
    ["IKEA 0815", "home"],
    ["LEROY MERLIN", "home"],
    ["EUROPAPARK", "activities"],
    ["GETYOURGUIDE", "activities"],
    ["TICKETCORNER", "entertainment"],
    ["INTERFLORA", "gifts_donations"],
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
    ["MONTHLY RENT", "home"],
    ["LOYER AOUT", "home"],
    ["Weekly groceries", "groceries"],
    ["Courses alimentaires", "groceries"],
    ["Dinner", "restaurants"],
    ["Livraison de repas", "restaurants"],
    ["Train ticket to Bern", "transport"],
    ["Billet de train", "transport"],
    ["Electricity bill", "home"],
    ["Facture électricité", "home"],
    ["PHARMACIE CENTRALE", "health"],
    ["Dentist appointment", "health"],
    ["CRECHE LES PETITS", "kids_family"],
    ["Cantine scolaire", "education"],
    ["FRAIS BANCAIRES", "finance_admin"],
    ["BANK ACCOUNT FEE", "finance_admin"],
    ["PATHE CINEMA", "entertainment"],
    ["TICKETMASTER CONCERT", "entertainment"],
    ["Vétérinaire", "pets"],
    ["Charity donation", "gifts_donations"],
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
    ["Produits d'entretien", "home"],
    ["Cleaning products", "home"],
    ["Plombier", "home"],
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
    expect(categoryOf("COOP BAU+HOBBY LAUSANNE")).toBe("home");
    expect(categoryOf("COOP VITALITY")).toBe("health");
    expect(categoryOf("COOP RESTAURANT")).toBe("restaurants");

    // Bare Coop is still a supermarket, a pharmacy and a filling station.
    expect(classify("COOP").decision).not.toBe("auto_assigned");
  });

  it("reads a Migros store format the same way", () => {
    expect(categoryOf("MIGROS DO IT GARDEN")).toBe("home");
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
    ["Éponges", "home"],
    ["Sacs poubelle", "home"],
    ["Piles", "home"],
    ["Rideaux", "home"],
    ["Facture de gaz", "home"],
    ["Forfait mobile", "home"],
    // Out and about.
    ["Plongée", "activities"],
    ["Fleurs", "gifts_donations"],
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
    expect(categoryOf("Eau de parfum")).toBe("personal_care");
    expect(categoryOf("Eau")).toBe("groceries");
  });

  it("tells a water bill from a bottle of water", () => {
    expect(categoryOf("Facture d'eau")).toBe("home");
    expect(categoryOf("Bouteilles d'eau")).toBe("groceries");
  });

  it("does not let an ingredient outvote the dish", () => {
    // "sucre" is a grocery; "crêpes au sucre" is not.
    expect(categoryOf("Crêpes au sucre")).toBe("restaurants");
    expect(categoryOf("Pain au chocolat")).toBe("restaurants");
  });

  it("files an outing bought as a present as a present", () => {
    expect(categoryOf("Parapente cadeau Célia")).toBe("gifts_donations");
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
   * A name that is also an ordinary word is usually still the brand: somebody
   * typing `Paul` into an expense means the bakery, and the safeguard that
   * makes that safe already exists. A single-word merchant rule under five
   * characters only matches when it *opens* the descriptor and everything
   * after it is noise, so `Paul` is the bakery and `Paul's share` is Paul.
   */
  it("takes a brand name at its word, and still knows a person", () => {
    expect(categoryOf("Paul")).toBe("restaurants");
    expect(categoryOf("Pret")).toBe("restaurants");
    expect(categoryOf("Oasis")).toBe("groceries");

    expect(classify("Paul's share").decision).toBe("needs_user_input");
    // `dinner` decides this one; the point is that `Paul` did not have to.
    expect(categoryOf("Dinner with Paul")).toBe("restaurants");
    expect(categoryOf("Prêt immobilier")).toBe("home");
  });

  /**
   * `Mars` is the exception, and the only one. It is a month, and a month
   * turns up in descriptions all year: `loyer mars`, `vacances en mars`.
   */
  it("leaves out the chocolate bar that is also a month", () => {
    expect(classify("Mars").decision).toBe("needs_user_input");
    expect(categoryOf("Loyer mars")).toBe("home");
    expect(classify("Vacances en mars").category).not.toBe("groceries");
  });
});

describe("names the normalizer used to eat", () => {
  /**
   * `Novotel` normalized to nothing: the identifier stripper read `no` as the
   * label "number" and `votel` as the number itself. Every brand starting with
   * one of those labels was invisible, including `refuge`, which this
   * repository ships as a lodging rule and which could never once have matched.
   */
  it("classifies the brands that used to normalize to nothing", () => {
    expect(categoryOf("Novotel")).toBe("lodging");
    expect(categoryOf("Refuge de montagne")).toBe("lodging");
    expect(categoryOf("NordVPN")).toBe("subscriptions");
    expect(categoryOf("Nordsee")).toBe("restaurants");
  });

  it("still strips a real identifier", () => {
    expect(classify("REF12345").decision).toBe("needs_user_input");
    expect(classify("AUTH 998877").decision).toBe("needs_user_input");
    expect(classify("No 12345").decision).toBe("needs_user_input");
  });
});

describe("brand names that contain another category's word", () => {
  it("reads a pet shop rather than a day out", () => {
    expect(categoryOf("Maxi zoo")).toBe("pets");
    expect(categoryOf("MAXI ZOO LAUSANNE")).toBe("pets");
    // The animals themselves are still an outing.
    expect(categoryOf("Zoo de Servion")).toBe("activities");
  });

  it("does not bill a fruit juice as a phone", () => {
    // `orange` is a telecom merchant, and was answering for the fruit.
    const juice = classify("Jus d'orange");
    expect(juice.category).toBe("groceries");
    expect(juice.decision).not.toBe("auto_assigned");
  });
});

/**
 * The second level.
 *
 * A subcategory is only ever asserted when something named it outright — a
 * brand that sells one thing, or a phrase that says it. Being sure of the
 * parent is not being sure of the child, and a plausible guess filed under the
 * user's name is worse than the blank it replaced.
 */
describe("subcategories", () => {
  const pairOf = (text: string) => {
    const result = classifyTransactionSync({
      merchant: text,
      description: text,
    });
    return [result.category ?? null, result.subcategory ?? null];
  };

  const named: [string, string, string][] = [
    ["Carrefour", "groceries", "supermarket"],
    ["Lidl", "groceries", "supermarket"],
    ["Uber", "transport", "taxi_ride_hailing"],
    ["SNCF", "transport", "train"],
    ["Shell", "transport", "fuel"],
    ["Airbnb", "lodging", "vacation_rental"],
    ["Netflix", "subscriptions", "streaming"],
    ["EDF", "home", "electricity"],
    ["IKEA", "home", "furniture"],
    ["Midas", "transport", "vehicle_maintenance"],
    ["Sephora", "personal_care", "cosmetics"],
    ["Coursera", "education", "courses"],
    ["Helsana", "insurance", "health"],
  ];

  it.each(named)("reads %s as %s / %s", (text, category, subcategory) => {
    expect(pairOf(text)).toEqual([category, subcategory]);
  });

  it("names one from the words as well as from the brand", () => {
    expect(pairOf("Facture d'électricité août")).toEqual([
      "home",
      "electricity",
    ]);
    expect(pairOf("Loyer mars")).toEqual(["home", "rent"]);
    expect(pairOf("Billet de train Lausanne")).toEqual(["transport", "train"]);
  });

  /**
   * The categories added when the taxonomy grew to eighteen, each reached
   * from the words rather than from a brand — which is the harder half, and
   * the one that decides whether a code is actually usable.
   */
  it("reaches the car through what was done to it", () => {
    expect(pairOf("Voiture d'occasion")).toEqual([
      "transport",
      "vehicle_purchase",
    ]);
    expect(pairOf("Leasing voiture janvier")).toEqual([
      "transport",
      "vehicle_lease",
    ]);
    expect(pairOf("Prêt auto")).toEqual(["transport", "vehicle_financing"]);
    expect(pairOf("Garage automobile")).toEqual([
      "transport",
      "vehicle_maintenance",
    ]);
    expect(pairOf("Immatriculation véhicule")).toEqual([
      "transport",
      "vehicle_registration",
    ]);
  });

  it("files a premium by what it covers, never by what it insures", () => {
    // The whole reason `insurance` exists: three of these used to land on
    // three different categories, so nothing could total them.
    expect(pairOf("Assurance habitation")).toEqual(["insurance", "home"]);
    expect(pairOf("Assurance auto")).toEqual(["insurance", "vehicle"]);
    expect(pairOf("Assurance maladie")).toEqual(["insurance", "health"]);
    expect(pairOf("Assurance vie")).toEqual(["insurance", "life"]);
    // Except the animal's, which stays with the animal on purpose.
    expect(categoryOf("Assurance animaux")).toBe("pets");
  });

  it("reads buying and leaving a home as the home it is", () => {
    expect(pairOf("Acquisition immobilière")).toEqual([
      "home",
      "home_purchase",
    ]);
    expect(pairOf("Dépôt de garantie")).toEqual(["home", "security_deposit"]);
    expect(pairOf("Société de déménagement")).toEqual(["home", "moving"]);
    expect(pairOf("Garde-meuble")).toEqual(["home", "storage"]);
  });

  it("files learning as education whoever is learning", () => {
    expect(pairOf("Frais de scolarité")).toEqual(["education", "tuition"]);
    expect(pairOf("Cours de langue")).toEqual(["education", "courses"]);
    expect(pairOf("Formation professionnelle")).toEqual([
      "education",
      "training",
    ]);
    expect(pairOf("Fournitures scolaires")).toEqual([
      "education",
      "school_supplies",
    ]);
  });

  it("files what is done to a person as personal care", () => {
    expect(pairOf("Coupe de cheveux")).toEqual([
      "personal_care",
      "hairdresser",
    ]);
    expect(pairOf("Pressing")).toEqual([
      "personal_care",
      "laundry_dry_cleaning",
    ]);
    expect(categoryOf("Manucure")).toBe("personal_care");
    // A massage is a spa afternoon until the words say a body hurts.
    expect(categoryOf("Massage")).toBe("personal_care");
    expect(categoryOf("Massage thérapeutique")).toBe("health");
  });

  it("takes in what `fees` never admitted", () => {
    expect(pairOf("Comptable")).toEqual(["finance_admin", "accounting"]);
    expect(pairOf("Renouvellement passeport")).toEqual([
      "finance_admin",
      "passport_visa",
    ]);
    expect(pairOf("Impôt sur le revenu")).toEqual(["finance_admin", "taxes"]);
    expect(categoryOf("Notaire")).toBe("finance_admin");
  });

  it("keeps recurrence and category apart", () => {
    // Balancia has recurring expenses of its own, so a thing that repeats is
    // not thereby a subscription. Only a purchase whose whole substance is
    // the arrangement belongs there.
    expect(categoryOf("Abonnement salle de sport")).toBe("health");
    expect(categoryOf("Transports en commun")).toBe("transport");
    expect(categoryOf("Forfait mobile")).toBe("home");
    expect(pairOf("Netflix")).toEqual(["subscriptions", "streaming"]);
  });

  it("leaves the field blank rather than guessing", () => {
    // "Restaurant Le Pont" is restaurants beyond argument — the word is what
    // decided it. Which of the seven kinds it was is not in the descriptor,
    // and being sure of the parent is not being sure of the child.
    expect(pairOf("Restaurant Le Pont")).toEqual(["restaurants", null]);
    // Same for a museum: the category is named outright, the child is not.
    expect(pairOf("Museum tickets")).toEqual(["activities", null]);
  });

  it("never returns a subcategory that does not belong to its category", () => {
    for (const [text] of named) {
      const result = classifyTransactionSync({
        merchant: text,
        description: text,
      });
      expect(isValidSubcategory(result.category, result.subcategory)).toBe(
        true,
      );
    }
  });

  it("hands back a subcategory the group taught, without re-deriving it", () => {
    // Accepting a remembered `Transport / Fuel` has to cost no extra tap.
    const mappings: LearnedMerchantMapping[] = [
      {
        scope: "group",
        rawMerchant: "ATELIER RAMUZ",
        normalizedMerchant: "atelier ramuz",
        category: "restaurants",
        subcategory: "cafe",
        transactionType: null,
        correctionCount: 2,
        conflictCount: 0,
      },
    ];

    const result = classifyTransactionSync(
      { merchant: "Atelier Ramuz", description: "Atelier Ramuz" },
      { mappings },
    );
    expect(result.category).toBe("restaurants");
    expect(result.subcategory).toBe("cafe");
  });

  it("drops a taught subcategory that no longer fits its category", () => {
    const mappings: LearnedMerchantMapping[] = [
      {
        scope: "group",
        rawMerchant: "ATELIER RAMUZ",
        normalizedMerchant: "atelier ramuz",
        category: "restaurants",
        // Learned under a code that has since been merged away.
        subcategory: "rent" as never,
        transactionType: null,
        correctionCount: 2,
        conflictCount: 0,
      },
    ];

    const result = classifyTransactionSync(
      { merchant: "Atelier Ramuz", description: "Atelier Ramuz" },
      { mappings },
    );
    expect(result.category).toBe("restaurants");
    expect(result.subcategory).toBeUndefined();
  });
});
