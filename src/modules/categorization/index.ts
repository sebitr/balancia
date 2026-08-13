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
export { CATEGORY_PROTOTYPES } from "./prototypes";

export {
  EXPENSE_CATEGORIES,
  FALLBACK_CATEGORY,
  TRANSACTION_TYPES,
  isExpenseCategory,
  isTransactionType,
  type ClassificationAlternative,
  type ClassificationDecision,
  type ClassificationResult,
  type ClassificationSource,
  type ClassifyTransactionInput,
  type ExpenseCategory,
  type LearnedMerchantMapping,
  type MappingScope,
  type ReceiptClassificationContext,
  type TransactionType,
} from "./types";
