/**
 * The expense vocabulary: eighteen categories, and what each may be broken
 * down into.
 *
 * This object is the single source of truth. The category type, the
 * subcategory types, the picker's order, validation, the classifier's
 * constraints and the translation keys are all *derived* from it — adding a
 * subcategory is one line here and one line in each message catalogue, and
 * nothing else in the codebase has a list to keep in step.
 *
 * Three rules hold the design together:
 *
 *  - **Codes are data; labels are not.** `transport` / `fuel` is what goes in
 *    the database. `Transport` / `Carburant` is what a French reader sees, and
 *    it lives in `messages/fr.json`. A translation can be reworded without a
 *    migration, and no rule is ever written against a label.
 *  - **A subcategory belongs to exactly one parent.** `fuel` is a transport
 *    subcategory and nothing else. The same *word* may appear under two
 *    parents (`repairs` is both a home cost and a shopping one; `training` is
 *    both a course and something a dog does), and `home`, `health` and
 *    `travel` are subcategories of `insurance` as well as being — or having
 *    been — category codes in their own right. The pair is what identifies a
 *    subcategory, and `isValidSubcategory` is what enforces that on every
 *    server boundary.
 *  - **A category answers "what was this money for", not where, when or how
 *    it was paid.** A restaurant meal on holiday is `restaurants`; a child's
 *    dentist is `health`; a monthly train pass is `transport`. The group
 *    already carries the occasion — "Rome 2026", "Our apartment" — so the
 *    taxonomy does not need a `travel` code, and recurrence is a property of
 *    an expense rather than a category of one.
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
 * left blank. It reaches further than the monthly bills: buying a home, the
 * deposit on a rented one, the removal van and the storage unit are all the
 * same place, at the moments it costs the most.
 *
 * `travel` is gone rather than merged. It never named a kind of spending, it
 * named an *occasion*: a flight is transport, a hotel is lodging, a museum is
 * an activity, and the week they happened in is not a category. Its rules
 * moved to the codes that describe the purchase.
 *
 * `personal_care`, `education` and `insurance` are splits, for the same
 * reason `lodging` once was — each was already being spent, filed under a
 * neighbour that then stopped meaning anything:
 *
 *  - **personal_care** — a haircut is not a purchase of goods, and leaving
 *    the hairdresser, the dry cleaner and the shampoo inside `shopping` made
 *    that category mean "money left the account" rather than "a thing was
 *    bought".
 *  - **education** — tuition sat under `kids_family`, which made it a fact
 *    about who was taught rather than about what was paid for. An evening
 *    language course is the same expense whoever takes it, so the age of the
 *    student stopped being what decides.
 *  - **insurance** — the premiums were scattered three ways: the flat's under
 *    `home`, the health cover under `health`, and the car's nowhere at all.
 *    Nobody can answer "what do we spend on insurance" from that. `pets` is
 *    the deliberate exception (see below).
 *
 * `fees` became `finance_admin` and `gifts` became `gifts_donations` —
 * renames that widen what the code admits, not changes of meaning. Fees were
 * never only a bank's: a tax bill, a passport renewal and an accountant are
 * the same kind of money, the kind that buys no goods and no experience.
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
  /**
   * Getting about, and the car that does it.
   *
   * Owning a vehicle is most of what a household spends on transport and
   * almost none of what it spends on any given journey, so the purchase, the
   * lease, the loan, the garage, the road tax and the car wash are all here —
   * beside the bus fare, because they answer the same question.
   *
   * The *insurance* is not: it is `insurance` / `vehicle`. A policy is a
   * policy whatever it covers, and splitting the premiums by what they insure
   * is what made the old taxonomy unable to total them.
   */
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
      "vehicle_purchase",
      "vehicle_lease",
      "vehicle_financing",
      "vehicle_maintenance",
      "vehicle_registration",
      "vehicle_wash",
      "other",
    ],
  },
  home: {
    subcategories: [
      "rent",
      "mortgage",
      "home_purchase",
      "down_payment",
      "security_deposit",
      "property_tax",
      "electricity",
      "gas",
      "water",
      "internet",
      "mobile_phone",
      "heating",
      "waste",
      "repairs",
      "maintenance",
      "renovation",
      "furniture",
      "appliances",
      "cleaning_supplies",
      "household_supplies",
      "cleaning_service",
      "gardening",
      "moving",
      "storage",
      "other",
    ],
  },
  /** Things, bought. Anything applied to a person is `personal_care`. */
  shopping: {
    subcategories: [
      "clothing",
      "shoes",
      "electronics",
      "accessories",
      "books",
      "hobbies",
      "sporting_goods",
      "toys",
      "general",
      "repairs",
      "other",
    ],
  },
  personal_care: {
    subcategories: [
      "hairdresser",
      "barber",
      "beauty",
      "cosmetics",
      "skincare",
      "toiletries",
      "spa",
      "massage",
      "laundry_dry_cleaning",
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
      "physiotherapy",
      "labs_tests",
      "glasses_contacts",
      "medical_devices",
      "fitness",
      "other",
    ],
  },
  /**
   * Learning, at any age.
   *
   * The line against `activities` is the purpose rather than the room: a
   * pottery evening for the pleasure of it is `activities`, a diploma course
   * is `education`, and a child's school is `education` and not
   * `kids_family` — who was taught is not what the money bought.
   */
  education: {
    subcategories: [
      "tuition",
      "school",
      "courses",
      "training",
      "tutoring",
      "books_materials",
      "school_supplies",
      "exams",
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
  /**
   * What is paid *for the arrangement itself*, not everything that recurs.
   *
   * Balancia has recurring expenses as their own concept, so a monthly train
   * pass is `transport`, a gym membership is `health`, and a phone plan is
   * `home`. Only a purchase whose whole substance is the subscription — a
   * streaming service, a software licence, a cloud plan — belongs here.
   */
  subscriptions: {
    subcategories: [
      "streaming",
      "software",
      "apps",
      "cloud_storage",
      "media",
      "memberships",
      "delivery_memberships",
      "other",
    ],
  },
  /**
   * Caring for somebody, which is a service and not a topic.
   *
   * Narrow on purpose. A child's school is `education`, their jacket is
   * `shopping`, their dentist is `health` and their swimming club is
   * `activities` — this category is the cost of the care itself, at either
   * end of a life.
   */
  kids_family: {
    subcategories: [
      "childcare",
      "babysitting",
      "baby",
      "allowance",
      "family_support",
      "elder_care",
      "caregiving",
      "child_support",
      "other",
    ],
  },
  /**
   * `pet_insurance` stays here rather than under `insurance`, and it is the
   * one deliberate inconsistency in the taxonomy. Everything an animal costs
   * is asked about together — "what does the dog come to" is a question
   * people actually ask — and a premium pulled out into the insurance total
   * would answer a question nobody asked at the price of the one they did.
   */
  pets: {
    subcategories: [
      "pet_food",
      "veterinary",
      "medication",
      "grooming",
      "pet_supplies",
      "pet_insurance",
      "boarding",
      "training",
      "other",
    ],
  },
  gifts_donations: {
    subcategories: [
      "gifts",
      "birthdays",
      "weddings",
      "celebrations",
      "charity",
      "donations",
      "religious_giving",
      "other",
    ],
  },
  /**
   * Premiums, by what the policy covers.
   *
   * `home`, `health` and `travel` appear here as subcategories and elsewhere
   * as category codes — `travel` is even a retired one. Nothing is confused
   * by that, because the pair is the identity: `insurance` / `home` is a
   * policy, `home` is a place, and no code in this file is ever read on its
   * own.
   */
  insurance: {
    subcategories: [
      "home",
      "vehicle",
      "health",
      "life",
      "travel",
      "liability",
      "legal_protection",
      "disability",
      "other",
    ],
  },
  /**
   * Money that buys neither goods nor an experience.
   *
   * Wider than the `fees` it replaces: a bank charge, an income tax bill, a
   * passport renewal, an accountant's invoice and a parking fine are all the
   * same kind of spending, and filing the last four as `other` was what made
   * `other` the second-largest slice on a real group's spread.
   */
  finance_admin: {
    subcategories: [
      "bank_fees",
      "card_fees",
      "exchange_fees",
      "interest",
      "loan_payment",
      "service_fees",
      "taxes",
      "government_fees",
      "passport_visa",
      "legal",
      "accounting",
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
 * Generic on the parent, so `SubcategoryOf<"transport">` is the seventeen
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
 *
 * `fees` and `gifts` are renames and nothing more: every row keeps its
 * meaning, and every subcategory either kept its code or is handled by
 * `LEGACY_SUBCATEGORIES` below.
 */
const LEGACY_CATEGORIES: Readonly<Record<string, ExpenseCategory>> = {
  housing: "home",
  utilities: "home",
  household: "home",
  family: "kids_family",
  travel: "other",
  fees: "finance_admin",
  gifts: "gifts_donations",
};

/**
 * Subcategories that moved to a different parent, keyed by
 * `<current parent>.<old subcategory>`.
 *
 * The key uses the *current* spelling of the parent, so a lookup happens
 * after `normalizeLegacyCategory` has run and there is only ever one spelling
 * to write down: a row stored as `housing` / `home_insurance` is read as
 * `home` / `home_insurance` and finds its entry here.
 *
 * Every entry is a move somebody could not have made themselves, because the
 * destination did not exist when they filed the row. That is the bar for
 * being in this table at all: `health` / `health_insurance` means the health
 * policy and can only mean that, so rewriting it to `insurance` / `health`
 * loses nothing and invents nothing.
 *
 * A subcategory that merely *disappeared*, with no successor that means the
 * same thing, is deliberately absent — `fees` / `late_fees` has no equivalent
 * under `finance_admin`, so it resolves to the parent with no child rather
 * than to whichever survivor looks nearest. Guessing there would file a fact
 * under the user's name that the user did not state.
 */
const LEGACY_SUBCATEGORIES: Readonly<
  Record<string, readonly [ExpenseCategory, ExpenseSubcategory | null]>
> = {
  // Premiums left the thing they insure, so that they can be totalled.
  "home.home_insurance": ["insurance", "home"],
  "health.health_insurance": ["insurance", "health"],
  // A haircut was never a purchase of goods.
  "shopping.personal_care": ["personal_care", "other"],
  "shopping.beauty": ["personal_care", "beauty"],
  // What is paid for is the subscription, not the watching.
  "entertainment.streaming": ["subscriptions", "streaming"],
  // School is what the money bought; the pupil's age is not.
  "kids_family.school": ["education", "school"],
  "kids_family.school_supplies": ["education", "school_supplies"],
  "kids_family.clothing": ["shopping", "clothing"],
  // "Activities" under Kids & Family was a whole category wearing a disguise,
  // and which of the eight it meant is exactly what the row does not say.
  "kids_family.activities": ["activities", "other"],
};

/**
 * The current code for a stored one.
 *
 * Returns the value unchanged when it is already current, the replacement
 * when it is one of the retired codes, and `null` for anything else —
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

/** A (category, subcategory) pair in the vocabulary as it stands today. */
export interface CategoryPair {
  readonly category: ExpenseCategory | null;
  readonly subcategory: ExpenseSubcategory | null;
}

/**
 * The pair a stored pair means today. The one place legacy values are read.
 *
 * Three things happen, in this order:
 *
 *  1. the category is brought up to date (`fees` → `finance_admin`);
 *  2. a subcategory that moved to a different parent takes its whole pair
 *     with it (`health` / `health_insurance` → `insurance` / `health`), which
 *     can change the category a second time;
 *  3. anything that does not belong under the category it ended on is
 *     dropped, because a subcategory hung on the wrong parent is not a
 *     smaller fact — it is a false one.
 *
 * `{ category: null }` comes back for free text and for anything that is not
 * a code: an imported label is somebody else's word for this row and turning
 * it into one of ours would be a guess. Callers that want to keep the label
 * check for null and keep their own value — see `categorizeImportedExpense`
 * and `categoryKeyOf`.
 *
 * Every reader of stored category data goes through here rather than keeping
 * its own table: the migration, the importers, the API, the classifier's
 * learned mappings, the statistics and the row renderer.
 */
export function normalizeLegacyPair(input: {
  readonly category: string | null | undefined;
  readonly subcategory?: string | null | undefined;
}): CategoryPair {
  const category = normalizeLegacyCategory(input.category);
  if (category === null) return { category: null, subcategory: null };

  const subcategory = input.subcategory || null;
  if (subcategory === null) return { category, subcategory: null };

  const key = `${category}.${subcategory}`;
  if (Object.hasOwn(LEGACY_SUBCATEGORIES, key)) {
    const [moved, leaf] = LEGACY_SUBCATEGORIES[key];
    return { category: moved, subcategory: leaf };
  }

  return {
    category,
    subcategory: isValidSubcategory(category, subcategory)
      ? (subcategory as ExpenseSubcategory)
      : null,
  };
}

/** True when `value` names a category that used to exist and no longer does. */
export function isLegacyCategory(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(LEGACY_CATEGORIES, value);
}

/** The retired codes, for the migration and its tests to iterate. */
export const LEGACY_CATEGORY_MAP = LEGACY_CATEGORIES;

/** The moved pairs, for the migration and its tests to iterate. */
export const LEGACY_SUBCATEGORY_MAP = LEGACY_SUBCATEGORIES;

/**
 * Headings the picker groups a category's subcategories under.
 *
 * Presentation only. These are not stored, never reach the database, and are
 * not part of the (category, subcategory) pair — an expense is `home` /
 * `electricity`, and `utilities` is merely the shelf that chip sits on.
 *
 * Only the two long categories have any, and the rule for earning shelves is
 * length: a flat run someone has to read to the end of stops being a list.
 * `home`'s five are deliberately the shape of what it replaced — someone who
 * filed rent under Housing and the electricity bill under Utilities for two
 * years finds both where they expect them — with the moving costs added as
 * their own shelf, because a removal van and a storage unit are a month of
 * someone's life and not upkeep. `transport`'s three separate the journey
 * from the car: a bus fare, the petrol that car runs on, and the car itself.
 *
 * Every other category is short enough to read at once, and inventing shelves
 * for nine chips would be organisation for its own sake.
 *
 * Their labels live under `expenses.categoryGroups.<category>.<group>`.
 */
export const SUBCATEGORY_GROUPS = {
  home: {
    housing: [
      "rent",
      "mortgage",
      "home_purchase",
      "down_payment",
      "security_deposit",
      "property_tax",
    ],
    utilities: [
      "electricity",
      "gas",
      "water",
      "internet",
      "mobile_phone",
      "heating",
      "waste",
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
    moving: ["moving", "storage"],
  },
  transport: {
    journeys: [
      "public_transport",
      "train",
      "flights",
      "ferry",
      "taxi_ride_hailing",
      "bike_scooter",
    ],
    running: [
      "fuel",
      "parking",
      "tolls",
      "vehicle_maintenance",
      "vehicle_registration",
      "vehicle_wash",
    ],
    vehicle: [
      "vehicle_purchase",
      "vehicle_lease",
      "vehicle_financing",
      "car_rental",
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
