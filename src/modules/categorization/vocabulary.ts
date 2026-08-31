/**
 * Which vocabulary a given entry is speaking.
 *
 * Two category lists share one `category` column, told apart by the entry's
 * `direction`. Every call site that validates, lists or labels a category has
 * to ask the same question — *which of the two* — and getting it wrong is
 * silent: `rent` resolves under both, so a mixed-up direction does not throw,
 * it just files money received as money spent.
 *
 * So the question is asked in one place. Call sites take a direction and hand
 * it here; nothing else branches on `direction === "in"` to pick a list.
 *
 * The direction is optional in the same way it is optional on the entry
 * itself: absent means `out`, which is what every caller meant before income
 * existed.
 */

import type { EntryDirection } from "@/modules/expenses/direction";
import {
  INCOME_CATEGORY_IDS,
  getIncomeSubcategories,
  isIncomeCategory,
  isValidIncomeSubcategory,
  type IncomeCategory,
} from "./income-taxonomy";
import {
  EXPENSE_CATEGORY_IDS,
  getSubcategories,
  isExpenseCategory,
  isValidSubcategory,
  type ExpenseCategory,
} from "./taxonomy";

/** A category code from whichever vocabulary the direction selects. */
export type EntryCategory = ExpenseCategory | IncomeCategory;

function isIncoming(direction: EntryDirection | undefined): boolean {
  return direction === "in";
}

/** The category codes valid for this direction, in declaration order. */
export function categoryIdsFor(
  direction: EntryDirection | undefined,
): readonly EntryCategory[] {
  return isIncoming(direction) ? INCOME_CATEGORY_IDS : EXPENSE_CATEGORY_IDS;
}

/** Whether a code names a category *of this direction*. */
export function isCategoryFor(
  direction: EntryDirection | undefined,
  value: unknown,
): boolean {
  return isIncoming(direction)
    ? isIncomeCategory(value)
    : isExpenseCategory(value);
}

/**
 * What may sit under a category, for this direction.
 *
 * Empty both when the category has no second level and when the code does not
 * belong to this direction's vocabulary at all — a caller that has already
 * checked `isCategoryFor` will not see the second case, and one that has not
 * gets an empty picker rather than a crash.
 */
export function subcategoriesFor(
  direction: EntryDirection | undefined,
  category: string,
): readonly string[] {
  if (isIncoming(direction)) {
    return isIncomeCategory(category) ? getIncomeSubcategories(category) : [];
  }
  return isExpenseCategory(category) ? getSubcategories(category) : [];
}

/**
 * Whether a (category, subcategory) pair agrees, for this direction.
 *
 * This is the check the server boundary runs. `null` remains valid for both
 * vocabularies: the second level is optional everywhere, and an entry with no
 * subcategory is not an entry that failed to have one.
 */
export function isValidSubcategoryFor(
  direction: EntryDirection | undefined,
  category: unknown,
  subcategory: unknown,
): boolean {
  return isIncoming(direction)
    ? isValidIncomeSubcategory(category, subcategory)
    : isValidSubcategory(category, subcategory);
}

/**
 * Whether a code is a real category *of the other direction*.
 *
 * The boundary needs this because `category` is deliberately not narrowed to
 * the vocabulary: an import writes the source's own label when nothing
 * recognised it — "Fournitures ménagères", "Bus/train" — and rejecting free
 * text would make every imported expense unsavable. So "not one of ours" is
 * not, on its own, an error.
 *
 * "One of *theirs*" is. `groceries` on an income is not an unrecognised label
 * a French bank invented, it is a code this app assigns a meaning to, and the
 * meaning is wrong for the direction. Free text still passes; a swapped
 * vocabulary does not.
 */
export function isCategoryOfOppositeDirection(
  direction: EntryDirection | undefined,
  value: unknown,
): boolean {
  if (typeof value !== "string" || value === "") return false;
  if (isCategoryFor(direction, value)) return false;
  return isIncoming(direction)
    ? isExpenseCategory(value)
    : isIncomeCategory(value);
}

/**
 * Whether a category survives a change of direction.
 *
 * It never does, and this states why in one place rather than at each call
 * site. The codes are not interchangeable even when they spell the same word:
 * `rent` as an expense is money paid to a landlord, `rent` as income is money
 * a tenant paid you. Carrying it across the type switch would keep a value
 * that reads correctly and means the opposite.
 *
 * Kept as a function rather than a constant `false` so the reasoning has
 * somewhere to live, and so a future vocabulary that *does* share codes has
 * one place to say so.
 */
export function categorySurvivesDirectionChange(): boolean {
  return false;
}
