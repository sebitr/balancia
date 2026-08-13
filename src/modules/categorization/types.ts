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

export const EXPENSE_CATEGORIES = [
  "groceries",
  "restaurants",
  "transport",
  "housing",
  "utilities",
  "shopping",
  "health",
  "entertainment",
  "travel",
  "subscriptions",
  "family",
  "pets",
  "gifts",
  "fees",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * `other` is a fallback, never a match. Rules must not name it, and the
 * ranking never lets it win on evidence — only on the absence of any.
 */
export const FALLBACK_CATEGORY: ExpenseCategory = "other";

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return (
    typeof value === "string" &&
    (EXPENSE_CATEGORIES as readonly string[]).includes(value)
  );
}

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
  readonly transactionType?: TransactionType | null;
  /** How many times someone confirmed this mapping. Starts at 1. */
  readonly correctionCount: number;
  /** How many times someone replaced it with a different category. */
  readonly conflictCount: number;
}
