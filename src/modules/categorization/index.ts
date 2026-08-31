/**
 * Automatic expense categorization.
 *
 * Everything exported here is pure and framework-free, so the same code runs
 * in a Server Action, in the recurring-expense worker and in the browser as
 * the user types. Database access lives in `./service`, which is
 * `server-only` and deliberately not re-exported.
 *
 * See `docs/categorization.md`.
 */

export {
  classifyTransaction,
  classifyTransactionSync,
  type ClassifyOptions,
} from "./classifier";

export {
  MAX_ALTERNATIVES,
  SIGNAL_WEIGHTS,
  THRESHOLDS,
  type Signal,
  type SignalGroup,
} from "./confidence";

export {
  foldText,
  merchantKey,
  normalizeMerchant,
  tokenize,
  type NormalizedMerchant,
} from "./normalize";

export {
  learnedEvidence,
  learningKeyFor,
  mappingConfidence,
  planCorrection,
  selectMapping,
  type CorrectionPlan,
} from "./learning";

export {
  SemanticClassifier,
  SEMANTIC_TUNING,
  similarityToScore,
  type Embedder,
  type SemanticScore,
} from "./semantic";

export { detectTransactionType, isIncomeLike } from "./transaction-type";

export { CATEGORY_SEEDS, type CategorySeed } from "./seeds";
export { INCOME_CATEGORY_SEEDS, type IncomeCategorySeed } from "./income-seeds";
export {
  classifyIncomeSync,
  type IncomeClassificationResult,
} from "./income-classifier";
export { CATEGORY_PROTOTYPES } from "./prototypes";

export {
  FALLBACK_INCOME_CATEGORY,
  INCOME_CATEGORIES,
  INCOME_CATEGORY_IDS,
  getIncomeSubcategories,
  hasIncomeSubcategories,
  isIncomeCategory,
  isValidIncomeSubcategory,
  type IncomeCategory,
  type IncomeSubcategory,
  type IncomeSubcategoryOf,
} from "./income-taxonomy";

export {
  categoryIdsFor,
  categorySurvivesDirectionChange,
  isCategoryFor,
  isCategoryOfOppositeDirection,
  isValidSubcategoryFor,
  subcategoriesFor,
  type EntryCategory,
} from "./vocabulary";

export {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_IDS,
  FALLBACK_CATEGORY,
  LEGACY_CATEGORY_MAP,
  LEGACY_SUBCATEGORY_MAP,
  SUBCATEGORY_GROUPS,
  TRANSACTION_TYPES,
  getSubcategories,
  getSubcategoryGroups,
  hasSubcategories,
  isExpenseCategory,
  isLegacyCategory,
  isTransactionType,
  isValidSubcategory,
  normalizeLegacyCategory,
  normalizeLegacyPair,
  type CategoryPair,
  type ClassificationAlternative,
  type ClassificationDecision,
  type ClassificationResult,
  type ClassificationSource,
  type ClassifyTransactionInput,
  type ExpenseCategory,
  type ExpenseSubcategory,
  type LearnedMerchantMapping,
  type MappingScope,
  type ReceiptClassificationContext,
  type SubcategoryOf,
  type TransactionType,
} from "./types";
