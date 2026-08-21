/**
 * Categorization vocabulary.
 *
 * Category and transaction-type identifiers are stable, English-looking
 * *codes* — they are what goes in the database and what rules are written
 * against. Their human labels live in `messages/*.json` under
 * `expenses.categories`, so a translation can change without touching data.
 * Never infer a category from a label.
 */

export const TRANSACTION_TYPES = [
  "expense",
  "income",
  "refund",
  "reimbursement",
  "transfer",
  "salary",
  "gift_income",
  "other_income",
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * The category vocabulary lives in `taxonomy.ts`, which is the single source
 * of truth for the codes, their subcategories and the retired codes that map
 * onto them. It is re-exported here so `@/modules/categorization` stays the
 * one import path callers need.
 */
import type { ExpenseCategory, ExpenseSubcategory } from "./taxonomy";

export {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_IDS,
  FALLBACK_CATEGORY,
  LEGACY_CATEGORY_MAP,
  SUBCATEGORY_GROUPS,
  getSubcategories,
  getSubcategoryGroups,
  hasSubcategories,
  isExpenseCategory,
  isLegacyCategory,
  isValidSubcategory,
  normalizeLegacyCategory,
  type ExpenseCategory,
  type ExpenseSubcategory,
  type SubcategoryOf,
} from "./taxonomy";

export function isTransactionType(value: unknown): value is TransactionType {
  return (
    typeof value === "string" &&
    (TRANSACTION_TYPES as readonly string[]).includes(value)
  );
}

/** Optional evidence lifted from a receipt (OCR or a structured import). */
export interface ReceiptClassificationContext {
  readonly merchant?: string;
  readonly itemNames?: readonly string[];
  readonly rawText?: string;
}

export interface ClassifyTransactionInput {
  /**
   * The merchant as the source system spelled it. Balancia has no separate
   * merchant field, so callers usually pass the expense description here and
   * in `description`; normalization copes with both.
   */
  readonly merchant?: string;
  readonly description?: string;
  readonly note?: string;
  readonly amount?: number;
  readonly currency?: string;
  /** Generated from a recurring template, or recognised as repeating. */
  readonly recurring?: boolean;
  readonly receipt?: ReceiptClassificationContext;
}

export interface ClassificationAlternative {
  readonly category: ExpenseCategory;
  readonly confidence: number;
}

export type ClassificationDecision =
  "auto_assigned" | "suggested" | "needs_user_input";

export type ClassificationSource =
  | "learned_mapping"
  | "contextual_override"
  | "merchant"
  | "phrase"
  | "keyword"
  | "semantic"
  | "combined"
  | "fallback";

export interface ClassificationResult {
  readonly transactionType: TransactionType;
  /** Absent when nothing scored well enough to name a category. */
  readonly category?: ExpenseCategory;
  readonly confidence: number;
  /**
   * The subcategory, when a rule named one outright — never a guess.
   *
   * Judged separately from the category and on its own threshold, because the
   * two questions have different answers: "Shell" is a filling station with no
   * doubt at all, while "Coop" is groceries beyond argument and could be a
   * supermarket, a bakery counter or a hardware aisle. Being sure of the
   * parent is not being sure of the child, and a wrong subcategory is worse
   * than an empty one — it is a fact the user did not state, filed under their
   * name.
   *
   * Always valid for `category`; `isValidSubcategory` holds over the pair.
   */
  readonly subcategory?: ExpenseSubcategory;
  /** Only meaningful when `subcategory` is set. */
  readonly subcategoryConfidence?: number;
  readonly decision: ClassificationDecision;
  readonly source: ClassificationSource;
  /** At most three, best first, excluding the chosen category. */
  readonly alternatives: readonly ClassificationAlternative[];
  readonly normalizedMerchant?: string;
  /** Why it decided that, e.g. `merchant:migros`, `phrase:supermarche`. */
  readonly signals: readonly string[];
}

export type MappingScope = "user" | "group";

/**
 * A merchant → category rule the users taught this instance, rather than one
 * shipped in the seed data. Group scope is shared by everyone in the group;
 * user scope follows one person across their groups.
 */
export interface LearnedMerchantMapping {
  readonly scope: MappingScope;
  readonly rawMerchant: string;
  readonly normalizedMerchant: string;
  readonly category: ExpenseCategory;
  /** The subcategory taught alongside it, when the user picked one. */
  readonly subcategory?: ExpenseSubcategory | null;
  readonly transactionType?: TransactionType | null;
  /** How many times someone confirmed this mapping. Starts at 1. */
  readonly correctionCount: number;
  /** How many times someone replaced it with a different category. */
  readonly conflictCount: number;
}
