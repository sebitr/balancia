/**
 * The income vocabulary: nine categories, and what each may be broken down
 * into.
 *
 * A second vocabulary rather than a wing of the first, because the two answer
 * different questions. An expense category answers "what was this money for";
 * an income category answers "where did this money come from". Nothing is
 * gained by making one list do both, and something real is lost: an income
 * filed as `home` was the bug this file exists to fix — *Rent — Rue des Bains
 * 12*, money **received**, was landing in the household's housing spend and
 * quietly inflating it.
 *
 * The two vocabularies share the `category` column, and that is deliberate:
 * an entry already carries `direction`, so the pair — direction and code — is
 * what identifies a category, exactly as (category, subcategory) is what
 * identifies a subcategory. `rent` is an income category *and* a `home`
 * subcategory on expenses, and neither is a mistake.
 *
 * What follows from that, and what every call site has to respect:
 *
 *  - **A code is only valid for its own direction.** `isIncomeCategory` and
 *    `isExpenseCategory` are separate questions, and the server boundary asks
 *    the one that matches the entry it is validating. `categoryFor` is the
 *    single place that picks.
 *  - **Switching type clears the category.** Not because the code would be
 *    unreadable — `rent` resolves in both — but because it would silently
 *    change meaning. See `add-entry-form.tsx`.
 *  - **Expense rules never run on income.** The classifier takes a direction
 *    and consults one seed table. A grocery rule scoring an incoming transfer
 *    is not a near miss, it is a category error.
 *
 * Everything else matches the expense taxonomy exactly: codes are data,
 * labels live in `messages/*.json` under `expenses.incomeCategories` and
 * `expenses.incomeSubcategories`, a subcategory belongs to exactly one
 * parent, and the second level is always optional.
 */

/**
 * The vocabulary, in the order the picker declares it.
 *
 * The order the reader *sees* is their own alphabet — the picker sorts with
 * `Intl.Collator` and pins `other` last, the same as it does for expenses.
 * This order is for reading the file.
 *
 * `rent` leads because it is the reason the type exists. Balancia's groups are
 * overwhelmingly households, and the money coming *into* a household ledger is
 * a rent share, a returned deposit, or somebody's half of a refund far more
 * often than it is a salary. `earnings` is in the list because a freelancer
 * splitting a studio does have income to record, not because it is common.
 *
 * `deposits` is separate from `refunds` although both are money coming back.
 * A refund reverses a purchase and usually cancels an expense already in the
 * ledger; a returned deposit closes something that was never spending in the
 * first place. Groups ask about them separately — "did we get the flat deposit
 * back" is a question with a date and an amount attached, and burying it among
 * purchase returns is how it stops being answerable.
 */
export const INCOME_CATEGORIES = {
  rent: {
    subcategories: [
      "monthly_rent",
      "parking",
      "storage",
      "utilities_share",
      "short_stay",
      "sublet",
      "other",
    ],
  },
  refunds: {
    subcategories: [
      "purchase_return",
      "cancelled_booking",
      "insurance_claim",
      "overpayment",
      "tax_refund",
      "other",
    ],
  },
  deposits: {
    subcategories: [
      "rental_deposit",
      "utility_deposit",
      "key_deposit",
      "other",
    ],
  },
  /**
   * Money the group put in itself.
   *
   * The kitty, the trip fund, the tenner everybody hands over before the
   * shopping run. It is the one income category that does not come from
   * outside the group at all, which is exactly why it needs to exist: without
   * it, a contribution gets filed as a refund and the group's own float looks
   * like money the world gave them.
   */
  contributions: {
    subcategories: [
      "group_fund",
      "trip_fund",
      "membership_dues",
      "gift_received",
      "other",
    ],
  },
  sales: {
    subcategories: [
      "secondhand",
      "tickets",
      "food_drinks",
      "merchandise",
      "other",
    ],
  },
  earnings: {
    subcategories: ["salary", "freelance", "bonus", "tips", "other"],
  },
  benefits: {
    subcategories: [
      "housing_allowance",
      "family_allowance",
      "grant",
      "insurance_payout",
      "other",
    ],
  },
  financial: {
    subcategories: ["interest", "dividends", "cashback", "other"],
  },
  /**
   * The escape hatch, and — as on the expense side — the only category with
   * nothing under it. "Other / Other" is a question asked twice.
   */
  other: {
    subcategories: [],
  },
} as const satisfies Record<
  string,
  { readonly subcategories: readonly string[] }
>;

export type IncomeCategory = keyof typeof INCOME_CATEGORIES;

/**
 * The subcategories one income category allows.
 *
 * Generic on the parent, for the same reason `SubcategoryOf` is: a mistyped
 * pair is a compile error at every call site that knows its category
 * statically.
 */
export type IncomeSubcategoryOf<C extends IncomeCategory> =
  (typeof INCOME_CATEGORIES)[C]["subcategories"][number];

/** Every income subcategory code, whatever its parent. */
export type IncomeSubcategory = IncomeSubcategoryOf<IncomeCategory>;

/** The categories in declaration order. Iterate this, never `Object.keys`. */
export const INCOME_CATEGORY_IDS = Object.keys(
  INCOME_CATEGORIES,
) as readonly IncomeCategory[];

/**
 * `other` is a fallback, never a match — the same contract the expense
 * vocabulary's `FALLBACK_CATEGORY` carries.
 */
export const FALLBACK_INCOME_CATEGORY: IncomeCategory = "other";

export function isIncomeCategory(value: unknown): value is IncomeCategory {
  return typeof value === "string" && Object.hasOwn(INCOME_CATEGORIES, value);
}

/**
 * What may sit under an income category, in declaration order.
 *
 * Empty for `other`, which is why callers ask instead of assuming there is a
 * second step.
 */
export function getIncomeSubcategories<C extends IncomeCategory>(
  category: C,
): readonly IncomeSubcategoryOf<C>[] {
  return INCOME_CATEGORIES[category].subcategories;
}

/** True when this income category offers a second step at all. */
export function hasIncomeSubcategories(category: IncomeCategory): boolean {
  return INCOME_CATEGORIES[category].subcategories.length > 0;
}

/**
 * Whether a subcategory belongs to an income category.
 *
 * Same contract as `isValidSubcategory` on the expense side: the pair is the
 * unit of truth, and `null` is always valid because the second level is
 * optional everywhere.
 */
export function isValidIncomeSubcategory(
  category: unknown,
  subcategory: unknown,
): boolean {
  if (subcategory === null || subcategory === undefined || subcategory === "") {
    return true;
  }
  if (!isIncomeCategory(category)) return false;
  if (typeof subcategory !== "string") return false;
  return (
    INCOME_CATEGORIES[category].subcategories as readonly string[]
  ).includes(subcategory);
}
