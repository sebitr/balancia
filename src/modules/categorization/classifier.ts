import {
  MAX_ALTERNATIVES,
  SIGNAL_WEIGHTS,
  THRESHOLDS,
  combineSignals,
  describeSignal,
  type Signal,
} from "./confidence";
import {
  collectDeterministicSignals,
  detectSubcategory,
  prepareText,
  type PreparedText,
} from "./deterministic";
import { learnedEvidence, type LearnedEvidence } from "./learning";
import type { SemanticClassifier } from "./semantic";
import {
  detectTransactionType,
  type TransactionTypeDetection,
} from "./transaction-type";
import { isValidSubcategory } from "./taxonomy";
import type {
  ClassificationAlternative,
  ClassificationResult,
  ClassificationSource,
  ClassifyTransactionInput,
  ExpenseCategory,
  ExpenseSubcategory,
  LearnedMerchantMapping,
} from "./types";

/**
 * The classifier.
 *
 * Order of authority, highest first:
 *
 *  1. the transaction type — a salary is not a small purchase
 *  2. a learned mapping, group scope before user scope
 *  3. contextual overrides (Apple, Amazon, Uber, filling stations)
 *  4. the merchant, exactly or by family
 *  5. strong phrases, then keywords
 *  6. semantic similarity, if an embedder was supplied
 *  7. nothing — ask
 *
 * Steps 3 to 6 are *evidence*: they are combined and ranked. Steps 1 and 2
 * are *decisions*: they short-circuit, because a mapping someone taught this
 * group must not be argued down by a keyword.
 *
 * A category is only ever applied on its own when it clears both thresholds:
 * `autoAssignMinScore`, and a `autoAssignMinMargin` lead over the runner-up.
 * Being confident about two categories at once is not being confident.
 *
 * `alternatives` always excludes the chosen category. When the decision is
 * `suggested`, the UI shows `[category, ...alternatives]` as the shortlist.
 *
 * The subcategory is decided afterwards and separately, against the category
 * that won — see `subcategoryFor`. It is never the reason a category is
 * chosen, and it is left blank far more often than it is filled.
 */

export interface ClassifyOptions {
  /** Mappings this user and group have taught the classifier. */
  readonly mappings?: readonly LearnedMerchantMapping[];
  /** Optional; without it the classification is purely deterministic. */
  readonly semantic?: SemanticClassifier | null;
}

interface Evaluation {
  readonly prepared: PreparedText;
  readonly detection: TransactionTypeDetection;
  readonly learned: LearnedEvidence | null;
  readonly signals: Map<ExpenseCategory, Signal[]>;
}

function evaluate(
  input: ClassifyTransactionInput,
  options: ClassifyOptions,
): Evaluation {
  const prepared = prepareText(input);
  // Type detection reads the text as written: normalization strips leading
  // payment words, and "paiement annulé" needs to keep its first word.
  const detection = detectTransactionType(
    [input.merchant, input.description, input.note].filter(Boolean).join(" "),
  );
  const learned = learnedEvidence(
    options.mappings ?? [],
    prepared.normalizedMerchant,
  );
  const { signals } = collectDeterministicSignals(input, prepared);
  return { prepared, detection, learned, signals };
}

/**
 * Classification without the semantic pass.
 *
 * Synchronous by design: this is what runs on every keystroke in the expense
 * form, and it must never make the field wait.
 */
export function classifyTransactionSync(
  input: ClassifyTransactionInput,
  options: ClassifyOptions = {},
): ClassificationResult {
  return finish(evaluate(input, options));
}

/**
 * Full classification.
 *
 * The semantic pass runs only when the rules were not already convincing, so
 * a recognised merchant costs no inference at all. A failing embedder is not
 * an error — the deterministic answer stands.
 */
export async function classifyTransaction(
  input: ClassifyTransactionInput,
  options: ClassifyOptions = {},
): Promise<ClassificationResult> {
  const evaluation = evaluate(input, options);
  const deterministic = finish(evaluation);

  const worthAsking =
    options.semantic &&
    deterministic.decision !== "auto_assigned" &&
    evaluation.learned === null &&
    evaluation.detection.type === "expense";
  if (!worthAsking) return deterministic;

  try {
    const scores = await options.semantic!.score(
      evaluation.prepared.semanticText,
    );
    for (const semantic of scores) {
      const bucket = evaluation.signals.get(semantic.category) ?? [];
      bucket.push({
        group: "semantic",
        token: semantic.prototype,
        score: semantic.score,
      });
      evaluation.signals.set(semantic.category, bucket);
    }
  } catch {
    // The model is optional; not having it is a supported configuration.
    return deterministic;
  }

  return finish(evaluation);
}

function finish(evaluation: Evaluation): ClassificationResult {
  const { prepared, detection, learned, signals } = evaluation;
  const ranked = rank(signals);

  if (learned) {
    return {
      transactionType: learned.transactionType ?? detection.type,
      category: learned.category,
      // A mapping that was taught with a subcategory hands back both halves,
      // so accepting a remembered `Transport / Fuel` costs no extra tap. A
      // mapping that only ever knew the category falls back to the rules.
      ...subcategoryFor(learned.category, prepared, learned.subcategory),
      confidence: round(learned.signal.score),
      decision: "auto_assigned",
      source: "learned_mapping",
      alternatives: toAlternatives(
        ranked.filter((entry) => entry.category !== learned.category),
      ),
      normalizedMerchant: prepared.normalizedMerchant,
      signals: [...detection.signals, describeSignal(learned.signal)],
    };
  }

  const best = ranked[0];
  const runnerUp = ranked[1];
  const base = {
    transactionType: detection.type,
    normalizedMerchant: prepared.normalizedMerchant,
  } as const;

  if (!best || best.confidence < THRESHOLDS.suggestMinScore) {
    return {
      ...base,
      confidence: best ? round(best.confidence) : 0,
      decision: "needs_user_input",
      source: "fallback",
      alternatives: toAlternatives(ranked),
      signals: [...detection.signals],
    };
  }

  const margin = best.confidence - (runnerUp?.confidence ?? 0);
  const confident =
    best.confidence >= THRESHOLDS.autoAssignMinScore &&
    margin >= THRESHOLDS.autoAssignMinMargin;

  return {
    ...base,
    category: best.category,
    ...subcategoryFor(best.category, prepared),
    confidence: round(best.confidence),
    // Money coming *in* is never silently filed as spending, however
    // recognisable the merchant is.
    decision:
      confident && detection.type === "expense" ? "auto_assigned" : "suggested",
    source: best.source,
    alternatives: toAlternatives(ranked.slice(1)),
    signals: [
      ...detection.signals,
      ...best.signals.map((signal) => describeSignal(signal)),
    ],
  };
}

/**
 * The subcategory to report for a settled category, as a spreadable partial.
 *
 * A remembered one wins outright: it is a decision somebody made about this
 * merchant, and re-deriving it from the text could only disagree with them.
 * Otherwise the rules are consulted, and their answer is kept only if it
 * clears `subcategoryMinScore` — which is set at merchant-and-phrase strength,
 * so nothing weaker than "this brand sells exactly this" ever fills the field.
 *
 * Returns an empty object rather than `{ subcategory: undefined }` so the
 * property is genuinely absent from the result, the way it is for every
 * transaction nobody could be specific about.
 */
function subcategoryFor(
  category: ExpenseCategory,
  prepared: PreparedText,
  remembered?: ExpenseSubcategory | null,
): { subcategory?: ExpenseSubcategory; subcategoryConfidence?: number } {
  if (remembered && isValidSubcategory(category, remembered)) {
    return {
      subcategory: remembered,
      subcategoryConfidence: SIGNAL_WEIGHTS.learnedGroupMapping,
    };
  }

  const detected = detectSubcategory(category, prepared);
  if (!detected || detected.confidence < THRESHOLDS.subcategoryMinScore) {
    return {};
  }
  return {
    subcategory: detected.subcategory,
    subcategoryConfidence: round(detected.confidence),
  };
}

interface RankedCategory {
  readonly category: ExpenseCategory;
  readonly confidence: number;
  readonly source: ClassificationSource;
  readonly signals: readonly Signal[];
}

function rank(
  signals: ReadonlyMap<ExpenseCategory, readonly Signal[]>,
): readonly RankedCategory[] {
  return [...signals]
    .map(([category, categorySignals]) => ({
      category,
      ...combineSignals(categorySignals),
    }))
    .filter((entry) => entry.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}

function toAlternatives(
  ranked: readonly RankedCategory[],
): readonly ClassificationAlternative[] {
  return ranked.slice(0, MAX_ALTERNATIVES).map((entry) => ({
    category: entry.category,
    confidence: round(entry.confidence),
  }));
}

/** Two decimals: these are ranks within one scale, not measurements. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
