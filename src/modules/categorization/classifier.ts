import {
  MAX_ALTERNATIVES,
  THRESHOLDS,
  combineSignals,
  describeSignal,
  type Signal,
} from "./confidence";
import {
  collectDeterministicSignals,
  prepareText,
  type PreparedText,
} from "./deterministic";
import { learnedEvidence, type LearnedEvidence } from "./learning";
import type { SemanticClassifier } from "./semantic";
import {
  detectTransactionType,
  type TransactionTypeDetection,
} from "./transaction-type";
import type {
  ClassificationAlternative,
  ClassificationResult,
  ClassificationSource,
  ClassifyTransactionInput,
  ExpenseCategory,
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
