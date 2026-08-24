import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_IDS,
  LEGACY_CATEGORY_MAP,
  LEGACY_SUBCATEGORY_MAP,
  SUBCATEGORY_GROUPS,
  getSubcategories,
  getSubcategoryGroups,
  hasSubcategories,
  isExpenseCategory,
  isLegacyCategory,
  isValidSubcategory,
  normalizeLegacyCategory,
  normalizeLegacyPair,
} from "./taxonomy";

/**
 * The vocabulary, and the two rules that hold it together: a subcategory
 * belongs to exactly one parent, and a code that was retired resolves to
 * exactly one replacement.
 */

describe("the categories", () => {
  it("is the eighteen, and nothing that was merged or renamed away", () => {
    expect(EXPENSE_CATEGORY_IDS).toHaveLength(18);

    for (const live of [
      "home",
      "kids_family",
      "personal_care",
      "education",
      "insurance",
      "finance_admin",
      "gifts_donations",
    ]) {
      expect(EXPENSE_CATEGORY_IDS).toContain(live);
      expect(isExpenseCategory(live)).toBe(true);
    }

    // Selectable is what these are not. They still *resolve* — that is
    // `normalizeLegacyCategory`'s job, tested below — but nothing offers
    // them, and nothing validates against them.
    for (const retired of [
      "housing",
      "utilities",
      "household",
      "travel",
      "family",
      "fees",
      "gifts",
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

  it("keeps settlement out of the vocabulary entirely", () => {
    // A repayment is a kind of transaction, not a kind of spending, and it
    // has its own table. It must never become a category someone can pick.
    expect(isExpenseCategory("settlement")).toBe(false);
    expect(EXPENSE_CATEGORY_IDS).not.toContain("settlement");
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
    // `repairs` is both a home cost and a shopping one; `training` is both a
    // course and something a dog does. The pair is the identity.
    expect(isValidSubcategory("home", "repairs")).toBe(true);
    expect(isValidSubcategory("shopping", "repairs")).toBe(true);
    expect(isValidSubcategory("education", "training")).toBe(true);
    expect(isValidSubcategory("pets", "training")).toBe(true);
    expect(isValidSubcategory("groceries", "repairs")).toBe(false);
  });

  it("lets a category code be a subcategory of insurance and nothing more", () => {
    // `home`, `health` and `travel` name policies here. That they are also —
    // or were also — categories is not a collision, because nothing ever
    // reads a subcategory without its parent.
    expect(isValidSubcategory("insurance", "home")).toBe(true);
    expect(isValidSubcategory("insurance", "health")).toBe(true);
    expect(isValidSubcategory("insurance", "travel")).toBe(true);
    expect(isValidSubcategory("home", "home")).toBe(false);
    expect(isValidSubcategory("health", "health")).toBe(false);
  });

  it("accepts the pairs the new categories were added for", () => {
    for (const [category, subcategory] of [
      ["transport", "vehicle_purchase"],
      ["transport", "vehicle_lease"],
      ["transport", "vehicle_financing"],
      ["transport", "vehicle_maintenance"],
      ["transport", "vehicle_registration"],
      ["home", "home_purchase"],
      ["home", "down_payment"],
      ["home", "security_deposit"],
      ["home", "moving"],
      ["home", "storage"],
      ["insurance", "vehicle"],
      ["education", "tuition"],
      ["personal_care", "hairdresser"],
      ["finance_admin", "accounting"],
      ["finance_admin", "passport_visa"],
      ["gifts_donations", "charity"],
    ] as const) {
      expect(isValidSubcategory(category, subcategory)).toBe(true);
    }
  });

  it("refuses the pairs that used to be valid and are not", () => {
    // Each of these moved to another parent. A payload still spelling them
    // this way is refused at the boundary and normalised on the way in — the
    // two halves of the same guarantee.
    for (const [category, subcategory] of [
      ["restaurants", "fuel"],
      ["home", "vehicle_purchase"],
      ["health", "health_insurance"],
      ["home", "home_insurance"],
      ["kids_family", "school"],
      ["kids_family", "clothing"],
      ["entertainment", "streaming"],
      ["shopping", "beauty"],
      ["finance_admin", "late_fees"],
    ] as const) {
      expect(isValidSubcategory(category, subcategory)).toBe(false);
    }
  });
});

describe("normalizeLegacyCategory", () => {
  it("maps every retired code to its replacement", () => {
    expect(normalizeLegacyCategory("housing")).toBe("home");
    expect(normalizeLegacyCategory("utilities")).toBe("home");
    expect(normalizeLegacyCategory("household")).toBe("home");
    expect(normalizeLegacyCategory("family")).toBe("kids_family");
    expect(normalizeLegacyCategory("fees")).toBe("finance_admin");
    expect(normalizeLegacyCategory("gifts")).toBe("gifts_donations");
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

describe("normalizeLegacyPair", () => {
  it("carries a renamed category's subcategory across untouched", () => {
    // `fees` → `finance_admin` is a rename: `bank_fees` means what it always
    // meant, and it survives the move whole.
    expect(
      normalizeLegacyPair({ category: "fees", subcategory: "bank_fees" }),
    ).toEqual({ category: "finance_admin", subcategory: "bank_fees" });
    expect(
      normalizeLegacyPair({ category: "gifts", subcategory: "weddings" }),
    ).toEqual({ category: "gifts_donations", subcategory: "weddings" });
  });

  it("moves a subcategory that changed parent, and takes the parent with it", () => {
    const moves = [
      [
        ["health", "health_insurance"],
        ["insurance", "health"],
      ],
      [
        ["home", "home_insurance"],
        ["insurance", "home"],
      ],
      [
        ["entertainment", "streaming"],
        ["subscriptions", "streaming"],
      ],
      [
        ["kids_family", "school"],
        ["education", "school"],
      ],
      [
        ["kids_family", "school_supplies"],
        ["education", "school_supplies"],
      ],
      [
        ["kids_family", "clothing"],
        ["shopping", "clothing"],
      ],
      [
        ["kids_family", "activities"],
        ["activities", "other"],
      ],
      [
        ["shopping", "beauty"],
        ["personal_care", "beauty"],
      ],
      [
        ["shopping", "personal_care"],
        ["personal_care", "other"],
      ],
    ] as const;

    for (const [[category, subcategory], [expected, leaf]] of moves) {
      expect(normalizeLegacyPair({ category, subcategory })).toEqual({
        category: expected,
        subcategory: leaf,
      });
    }
  });

  it("finds a move through a category that was itself renamed", () => {
    // `housing` / `home_insurance` is two hops: the category becomes `home`,
    // and only then does the pair table recognise it.
    expect(
      normalizeLegacyPair({
        category: "housing",
        subcategory: "home_insurance",
      }),
    ).toEqual({ category: "insurance", subcategory: "home" });
  });

  it("keeps the parent and drops a subcategory with no successor", () => {
    // Nothing under `finance_admin` means "late". The nearest survivor would
    // be a guess, and a guess filed under the user's name is worse than the
    // blank it replaces.
    expect(
      normalizeLegacyPair({ category: "fees", subcategory: "late_fees" }),
    ).toEqual({ category: "finance_admin", subcategory: null });
  });

  it("leaves a current pair exactly as it found it", () => {
    expect(
      normalizeLegacyPair({ category: "transport", subcategory: "fuel" }),
    ).toEqual({ category: "transport", subcategory: "fuel" });
    expect(normalizeLegacyPair({ category: "other" })).toEqual({
      category: "other",
      subcategory: null,
    });
  });

  it("declines free text rather than inventing a code for it", () => {
    for (const label of ["Fournitures ménagères", "Chalet fund", "", null]) {
      expect(normalizeLegacyPair({ category: label })).toEqual({
        category: null,
        subcategory: null,
      });
    }
    // Including a subcategory hung on free text, which was never a pair.
    expect(
      normalizeLegacyPair({ category: "Chalet fund", subcategory: "rent" }),
    ).toEqual({ category: null, subcategory: null });
  });

  it("always returns a pair the validator accepts", () => {
    const stored = [
      ...Object.keys(LEGACY_CATEGORY_MAP),
      ...EXPENSE_CATEGORY_IDS,
    ];
    const leaves = [
      ...new Set(
        Object.keys(LEGACY_SUBCATEGORY_MAP).map((key) => key.split(".")[1]),
      ),
      "late_fees",
      "fuel",
      "rent",
      null,
    ];

    for (const category of stored) {
      for (const subcategory of leaves) {
        const pair = normalizeLegacyPair({ category, subcategory });
        if (pair.category === null) {
          expect(pair.subcategory).toBeNull();
          continue;
        }
        expect(isExpenseCategory(pair.category)).toBe(true);
        expect(isValidSubcategory(pair.category, pair.subcategory)).toBe(true);
      }
    }
  });

  it("resolves every moved pair onto a live one", () => {
    for (const [key, [category, subcategory]] of Object.entries(
      LEGACY_SUBCATEGORY_MAP,
    )) {
      // The key's parent has to be a code that still exists, because the
      // lookup happens after `normalizeLegacyCategory` has run.
      expect(isExpenseCategory(key.split(".")[0])).toBe(true);
      expect(isExpenseCategory(category)).toBe(true);
      expect(isValidSubcategory(category, subcategory)).toBe(true);
    }
  });
});

describe("the picker's groupings", () => {
  it("shelves every one of Home's twenty-four, `other` aside", () => {
    const groups = getSubcategoryGroups("home");
    expect(groups).not.toBeNull();

    const shelved = groups!.flatMap((group) => group.subcategories);
    const expected = getSubcategories("home").filter(
      (leaf) => leaf !== "other",
    );
    expect([...shelved].sort()).toEqual([...expected].sort());
  });

  it("shelves every one of Transport's sixteen, `other` aside", () => {
    const groups = getSubcategoryGroups("transport");
    expect(groups).not.toBeNull();

    const shelved = groups!.flatMap((group) => group.subcategories);
    const expected = getSubcategories("transport").filter(
      (leaf) => leaf !== "other",
    );
    expect([...shelved].sort()).toEqual([...expected].sort());
  });

  it("leaves every category short enough to read at once flat", () => {
    for (const category of EXPENSE_CATEGORY_IDS) {
      if (category === "home" || category === "transport") continue;
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

describe("the migration that rewrites the stored rows", () => {
  /**
   * The SQL and the tables above say the same thing twice, and this is what
   * stops them drifting apart. A move added here but not to `0020` leaves
   * rows that only the render-time normaliser rescues; one added to `0020`
   * but not here leaves the API refusing a payload the database now holds.
   *
   * Committed SQL is never edited, so a *future* move belongs in a new
   * migration and in this list — which is the point of asserting against the
   * whole `drizzle/` directory rather than against one file.
   */
  const sql = readFileSync(
    path.join(process.cwd(), "drizzle", "0021_bright_ultron.sql"),
    "utf8",
  );

  const TABLES = [
    "expenses",
    "recurring_expenses",
    "expense_category_mappings",
  ] as const;

  it("renames every retired category in all three tables", () => {
    for (const table of TABLES) {
      expect(sql).toContain(
        `UPDATE "${table}" SET "category" = 'finance_admin'\n  WHERE "category" = 'fees';`,
      );
      expect(sql).toContain(
        `UPDATE "${table}" SET "category" = 'gifts_donations'\n  WHERE "category" = 'gifts';`,
      );
    }
  });

  it("moves every pair the taxonomy says moved, in all three tables", () => {
    for (const [key, [category, subcategory]] of Object.entries(
      LEGACY_SUBCATEGORY_MAP,
    )) {
      const [parent, leaf] = key.split(".");
      const target =
        subcategory === null
          ? `"subcategory" = NULL`
          : `"subcategory" = '${subcategory}'`;
      for (const table of TABLES) {
        expect(sql).toContain(
          [
            `UPDATE "${table}" SET "category" = '${category}', ${target}`,
            `  WHERE "category" = '${parent}' AND "subcategory" = '${leaf}';`,
          ].join("\n"),
        );
      }
    }
  });

  it("clears the one subcategory that has no successor", () => {
    for (const table of TABLES) {
      expect(sql).toContain(
        `UPDATE "${table}" SET "subcategory" = NULL\n  WHERE "category" = 'finance_admin' AND "subcategory" = 'late_fees';`,
      );
    }
  });

  it("deletes nothing", () => {
    // Unlike `travel` in 0019, every code here is a rename or a move, and the
    // user's judgement survives all of them.
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
  });
});
