/**
 * The expense vocabulary: fifteen categories, and what each may be broken
 * down into.
 *
 * This object is the single source of truth. The category type, the
 * subcategory types, the picker's order, validation, the classifier's
 * constraints and the translation keys are all *derived* from it — adding a
 * subcategory is one line here and one line in each message catalogue, and
 * nothing else in the codebase has a list to keep in step.
 *
 * Two rules hold the design together:
 *
 *  - **Codes are data; labels are not.** `transport` / `fuel` is what goes in
 *    the database. `Transport` / `Carburant` is what a French reader sees, and
 *    it lives in `messages/fr.json`. A translation can be reworded without a
 *    migration, and no rule is ever written against a label.
 *  - **A subcategory belongs to exactly one parent.** `fuel` is a transport
 *    subcategory and nothing else. The same *word* may appear under two
 *    parents (`streaming` is both entertainment and a subscription;
 *    `clothing` is both shopping and a kids-and-family cost), but the pair is
 *    what identifies it, and `isValidSubcategory` is what enforces that on
 *    every server boundary.
 *
 * Subcategories are optional everywhere. An expense filed as `home` with no
 * subcategory is complete, not half-entered — see `docs/categorization.md`.
 */

/**
 * The vocabulary, in the order the picker lays it out.
 *
 * `home` is a merge, not an addition: `housing` (the rent), `utilities` (the
 * bills) and `household` (the upkeep) were three codes for one place, and
 * which of them a plumber's invoice belonged to was a coin toss that split
 * every flat-share's biggest expense across three slices of the spread. They
 * are one category now, and the distinction that actually mattered — rent
 * versus electricity versus a repair — moved down a level where it can be
 * left blank.
 *
 * `travel` is gone rather than merged. It never named a kind of spending, it
 * named an *occasion*: a flight is transport, a hotel is lodging, a museum is
 * an activity, and the week they happened in is not a category. Its rules
 * moved to the codes that describe the purchase.
 */
export const EXPENSE_CATEGORIES = {
  groceries: {
    subcategories: [
      "supermarket",
      "bakery",
      "butcher",
      "market",
      "convenience_store",
      "drinks",
      "other",
    ],
  },
  restaurants: {
    subcategories: [
      "restaurant",
      "cafe",
      "bar",
      "fast_food",
      "takeaway",
      "food_delivery",
      "other",
    ],
  },
  transport: {
    subcategories: [
      "public_transport",
      "taxi_ride_hailing",
      "fuel",
      "parking",
      "tolls",
      "train",
      "flights",
      "ferry",
      "car_rental",
      "bike_scooter",
      "other",
    ],
  },
  home: {
    subcategories: [
      "rent",
      "mortgage",
      "home_insurance",
      "property_tax",
      "electricity",
      "gas",
      "water",
      "internet",
      "mobile_phone",
      "heating",
      "repairs",
      "maintenance",
      "renovation",
      "cleaning_service",
      "gardening",
      "furniture",
      "appliances",
      "cleaning_supplies",
      "household_supplies",
      "other",
    ],
  },
  shopping: {
    subcategories: [
      "clothing",
      "shoes",
      "electronics",
      "accessories",
      "personal_care",
      "beauty",
      "books",
      "hobbies",
      "other",
    ],
  },
  health: {
    subcategories: [
      "doctor",
      "dentist",
      "pharmacy",
      "hospital",
      "therapy",
      "glasses_contacts",
      "health_insurance",
      "fitness",
      "other",
    ],
  },
  entertainment: {
    subcategories: [
      "cinema",
      "concerts",
      "shows",
      "nightlife",
      "games",
      "streaming",
      "music",
      "events",
      "other",
    ],
  },
  activities: {
    subcategories: [
      "attractions",
      "museums",
      "tours",
      "excursions",
      "sports",
      "outdoor_activities",
      "classes_workshops",
      "theme_parks",
      "other",
    ],
  },
  lodging: {
    subcategories: [
      "hotel",
      "vacation_rental",
      "hostel",
      "camping",
      "guesthouse",
      "other",
    ],
  },
  subscriptions: {
    subcategories: [
      "software",
      "streaming",
      "media",
      "cloud_storage",
      "memberships",
      "apps",
      "delivery_memberships",
      "other",
    ],
  },
  kids_family: {
    subcategories: [
      "childcare",
      "school",
      "school_supplies",
      "baby",
      "clothing",
      "activities",
      "allowance",
      "family_support",
      "other",
    ],
  },
  pets: {
    subcategories: [
      "pet_food",
      "veterinary",
      "medication",
      "grooming",
      "pet_supplies",
      "pet_insurance",
      "boarding",
      "other",
    ],
  },
  gifts: {
    subcategories: [
      "gifts",
      "birthdays",
      "weddings",
      "celebrations",
      "donations",
      "other",
    ],
  },
  fees: {
    subcategories: [
      "bank_fees",
      "card_fees",
      "exchange_fees",
      "service_fees",
      "late_fees",
      "taxes",
      "fines",
      "other",
    ],
  },
  /**
   * The escape hatch, and the only category with nothing under it.
   *
   * "Other / Other" is a question asked twice, so the picker skips the second
   * step entirely and stores `null`. `hasSubcategories` is what call sites ask
   * rather than testing for this code by name.
   */
  other: {
    subcategories: [],
  },
} as const satisfies Record<
  string,
  { readonly subcategories: readonly string[] }
>;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

/**
 * The subcategories one category allows.
 *
 * Generic on the parent, so `SubcategoryOf<"transport">` is the eleven
 * transport codes and nothing else — a mistyped pair is a compile error at
 * every call site that knows its category statically.
 */
export type SubcategoryOf<C extends ExpenseCategory> =
  (typeof EXPENSE_CATEGORIES)[C]["subcategories"][number];

/** Every subcategory code in the vocabulary, whatever its parent. */
export type ExpenseSubcategory = SubcategoryOf<ExpenseCategory>;

/** The categories in picker order. Iterate this, never `Object.keys`. */
export const EXPENSE_CATEGORY_IDS = Object.keys(
  EXPENSE_CATEGORIES,
) as readonly ExpenseCategory[];

/**
 * `other` is a fallback, never a match. Rules must not name it, and the
 * ranking never lets it win on evidence — only on the absence of any.
 */
export const FALLBACK_CATEGORY: ExpenseCategory = "other";

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && Object.hasOwn(EXPENSE_CATEGORIES, value);
}

/**
 * What may sit under a category, in the order the picker lays it out.
 *
 * Empty for `other`, which is the whole reason callers ask this instead of
 * assuming every category has a second step.
 */
export function getSubcategories<C extends ExpenseCategory>(
  category: C,
): readonly SubcategoryOf<C>[] {
  return EXPENSE_CATEGORIES[category].subcategories;
}

/** True when this category offers a second step at all. */
export function hasSubcategories(category: ExpenseCategory): boolean {
  return EXPENSE_CATEGORIES[category].subcategories.length > 0;
}

/**
 * Whether a subcategory belongs to a category.
 *
 * The pair is the unit of truth, so this takes both: `fuel` is valid, but only
 * under `transport`. `null` is always valid — a subcategory is optional, and
 * an expense that has none is not an expense that failed to have one.
 *
 * This is the check every server boundary runs. The picker clears the child
 * when the parent changes, but a form is a convenience and not a guarantee:
 * the API, the importers and the recurring generator all reach the column
 * without going through it.
 */
export function isValidSubcategory(
  category: unknown,
  subcategory: unknown,
): boolean {
  if (subcategory === null || subcategory === undefined || subcategory === "") {
    return true;
  }
  if (!isExpenseCategory(category)) return false;
  if (typeof subcategory !== "string") return false;
  return (
    EXPENSE_CATEGORIES[category].subcategories as readonly string[]
  ).includes(subcategory);
}

/**
 * Categories that no longer exist, and what they became.
 *
 * Kept as data rather than as a chain of `if`s in the UI, because five
 * different readers need the same answer: the migration that rewrites the
 * column, the importer reading a backup written by an older Balancia, the
 * Splitwise mapping, the API accepting a payload from a client that has not
 * been updated, and the row renderer meeting a value the migration somehow
 * missed.
 *
 * `travel` resolves to `other` on purpose. Its rows are a mix of flights,
 * hotel nights and museum tickets, and the only thing they have in common is
 * the trip — guessing which of `transport`, `lodging` or `activities` a given
 * row meant would silently invent a fact from a description. `other` says
 * what is actually known: it was spending, and nobody has filed it since the
 * code it was filed under stopped existing.
 */
const LEGACY_CATEGORIES: Readonly<Record<string, ExpenseCategory>> = {
  housing: "home",
  utilities: "home",
  household: "home",
  family: "kids_family",
  travel: "other",
};

/**
 * The current code for a stored one.
 *
 * Returns the value unchanged when it is already current, the replacement
 * when it is one of the five retired codes, and `null` for anything else —
 * including free text an import kept verbatim, which is not a code and must
 * not be turned into one here.
 */
export function normalizeLegacyCategory(
  value: string | null | undefined,
): ExpenseCategory | null {
  if (!value) return null;
  if (isExpenseCategory(value)) return value;
  return Object.hasOwn(LEGACY_CATEGORIES, value)
    ? LEGACY_CATEGORIES[value]
    : null;
}

/** True when `value` names a category that used to exist and no longer does. */
export function isLegacyCategory(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(LEGACY_CATEGORIES, value);
}

/** The retired codes, for the migration and its tests to iterate. */
export const LEGACY_CATEGORY_MAP = LEGACY_CATEGORIES;

/**
 * Headings the picker groups a category's subcategories under.
 *
 * Presentation only. These are not stored, never reach the database, and are
 * not part of the (category, subcategory) pair — an expense is `home` /
 * `electricity`, and `utilities` is merely the shelf that chip sits on.
 *
 * Only `home` has any. Twenty subcategories in one flat run is a wall, and the
 * four shelves are deliberately the shape of what `home` replaced: someone who
 * has filed rent under Housing and the electricity bill under Utilities for
 * two years finds both where they expect them, on the first screen after the
 * merge. Every other category is short enough to read at once, and inventing
 * shelves for nine chips would be organisation for its own sake.
 *
 * Their labels live under `expenses.categoryGroups.<category>.<group>`.
 */
export const SUBCATEGORY_GROUPS = {
  home: {
    housing: ["rent", "mortgage", "home_insurance", "property_tax"],
    utilities: [
      "electricity",
      "gas",
      "water",
      "internet",
      "mobile_phone",
      "heating",
    ],
    upkeep: [
      "repairs",
      "maintenance",
      "renovation",
      "cleaning_service",
      "gardening",
    ],
    supplies: [
      "furniture",
      "appliances",
      "cleaning_supplies",
      "household_supplies",
    ],
  },
} as const satisfies {
  readonly [C in ExpenseCategory]?: Readonly<
    Record<string, readonly SubcategoryOf<C>[]>
  >;
};

/** The group headings for a category, in display order, or null for a flat pane. */
export function getSubcategoryGroups(
  category: ExpenseCategory,
):
  | readonly { group: string; subcategories: readonly ExpenseSubcategory[] }[]
  | null {
  const groups = (
    SUBCATEGORY_GROUPS as Readonly<
      Record<string, Readonly<Record<string, readonly ExpenseSubcategory[]>>>
    >
  )[category];
  if (!groups) return null;
  return Object.entries(groups).map(([group, subcategories]) => ({
    group,
    subcategories,
  }));
}
