import {
  MAX_ALTERNATIVES,
  SIGNAL_WEIGHTS,
  THRESHOLDS,
  combineSignals,
  type Signal,
} from "./confidence";
import {
  compileMerchant,
  compilePhrase,
  merchantScore,
  nonEmpty,
  prepareText,
  type CompiledPhrase,
  type PreparedText,
} from "./deterministic";
import {
  INCOME_CATEGORY_SEEDS,
  type IncomeCategorySeed,
  type IncomeSubcategorySeed,
} from "./income-seeds";
import {
  isValidIncomeSubcategory,
  type IncomeCategory,
  type IncomeSubcategory,
} from "./income-taxonomy";
import { containsTokenRun } from "./normalize";
import { allPhrases } from "./seeds";
import type {
  ClassificationDecision,
  ClassificationSource,
  ClassifyTransactionInput,
} from "./types";

/**
 * Classifying money that came in.
 *
 * A separate pipeline from `classifier.ts`, not a flag on it. The requirement
 * is that expense rules never run on income — *Rent — Rue des Bains 12* was
 * filing received money as a housing expense — and the cheapest way to
 * guarantee that is for the expense seed table to be unreachable from here.
 * There is no direction parameter to pass wrongly, and no code path that
 * consults both.
 *
 * What it deliberately does *not* have, and why:
 *
 *  - **No transaction-type detection.** The caller already knows: this
 *    function is only ever reached for `direction: "in"`. The expense
 *    classifier has to guess, which is why it refuses to auto-assign anything
 *    that looks incoming.
 *  - **No learned mappings.** `expense_category_mappings` keys a merchant to a
 *    category with no direction column, so teaching it `rent → rent` from an
 *    income would corrupt the expense side of the same merchant. Income
 *    learning wants its own scope; until it has one, nothing is remembered.
 *  - **No semantic pass.** `CATEGORY_PROTOTYPES` describes spending. Scoring
 *    an incoming transfer against them would be the exact mistake this module
 *    exists to prevent.
 *
 * Everything else is the shared machinery: the same normalization, the same
 * signal weights, the same noisy-OR combination and the same thresholds, so a
 * confidence means the same thing on both sides of the ledger.
 */

export interface IncomeClassificationResult {
  /** Absent when nothing scored well enough to name a category. */
  readonly category?: IncomeCategory;
  readonly confidence: number;
  /** Only when a rule named it outright — never a guess. */
  readonly subcategory?: IncomeSubcategory;
  /** Only meaningful when `subcategory` is set. */
  readonly subcategoryConfidence?: number;
  readonly decision: ClassificationDecision;
  readonly source: ClassificationSource;
  /** At most three, best first, excluding the chosen category. */
  readonly alternatives: readonly {
    readonly category: IncomeCategory;
    readonly confidence: number;
  }[];
  readonly normalizedMerchant?: string;
  readonly signals: readonly string[];
}

interface CompiledIncomeSeed {
  readonly id: IncomeCategory;
  readonly merchants: readonly CompiledPhrase[];
  readonly fragments: readonly CompiledPhrase[];
  readonly ambiguous: readonly CompiledPhrase[];
  readonly phrases: readonly CompiledPhrase[];
  readonly keywords: readonly CompiledPhrase[];
  readonly excludes: readonly CompiledPhrase[];
}

function compileSeed(seed: IncomeCategorySeed): CompiledIncomeSeed {
  return {
    id: seed.id,
    merchants: (seed.merchants ?? []).map(compileMerchant).filter(nonEmpty),
    fragments: (seed.merchantFragments ?? [])
      .map(compilePhrase)
      .filter(nonEmpty),
    ambiguous: (seed.ambiguousMerchants ?? [])
      .map(compileMerchant)
      .filter(nonEmpty),
    phrases: allPhrases(seed.strongPhrases).map(compilePhrase).filter(nonEmpty),
    keywords: allPhrases(seed.weakKeywords).map(compilePhrase).filter(nonEmpty),
    excludes: (seed.excludes ?? []).map(compilePhrase).filter(nonEmpty),
  };
}

/** Compiled once: the seed data never changes at runtime. */
const COMPILED: readonly CompiledIncomeSeed[] =
  INCOME_CATEGORY_SEEDS.map(compileSeed);

interface CompiledIncomeSubcategory {
  readonly id: IncomeSubcategory;
  readonly merchants: readonly CompiledPhrase[];
  readonly phrases: readonly CompiledPhrase[];
}

const COMPILED_SUBCATEGORIES: ReadonlyMap<
  IncomeCategory,
  readonly CompiledIncomeSubcategory[]
> = new Map(
  INCOME_CATEGORY_SEEDS.map((seed) => [
    seed.id,
    (seed.subcategories ?? []).map((rule: IncomeSubcategorySeed) => ({
      id: rule.id,
      merchants: (rule.merchants ?? []).map(compileMerchant).filter(nonEmpty),
      phrases: allPhrases(rule.phrases).map(compilePhrase).filter(nonEmpty),
    })),
  ]),
);

/**
 * Scores every income category against the seed rules.
 *
 * The tiers are the expense classifier's, minus the contextual overrides —
 * those exist to separate merchants that sell across categories, and income
 * has almost no merchants to separate.
 */
function collectSignals(prepared: PreparedText): Map<IncomeCategory, Signal[]> {
  const signals = new Map<IncomeCategory, Signal[]>();
  const add = (category: IncomeCategory, signal: Signal): void => {
    const bucket = signals.get(category);
    if (bucket) bucket.push(signal);
    else signals.set(category, [signal]);
  };

  for (const seed of COMPILED) {
    const excluded = seed.excludes.some((phrase) =>
      containsTokenRun(prepared.textStems, phrase.stems),
    );

    for (const merchant of seed.merchants) {
      const score = merchantScore(prepared.merchantTokens, merchant);
      if (score !== null) {
        add(seed.id, { group: "merchant", token: merchant.token, score });
      }
    }

    for (const fragment of seed.fragments) {
      if (containsTokenRun(prepared.merchantTokens, fragment.tokens)) {
        add(seed.id, {
          group: "merchant",
          token: fragment.token,
          score: SIGNAL_WEIGHTS.merchantFamily,
        });
      }
    }

    for (const ambiguous of seed.ambiguous) {
      const score = merchantScore(prepared.merchantTokens, ambiguous);
      if (score !== null) {
        add(seed.id, {
          group: "merchant",
          token: ambiguous.token,
          score: SIGNAL_WEIGHTS.ambiguousMerchant,
        });
      }
    }

    // Text evidence is what `excludes` suppresses; a merchant match is a name
    // and stands whatever else the description says.
    if (excluded) continue;

    for (const phrase of seed.phrases) {
      if (containsTokenRun(prepared.textStems, phrase.stems)) {
        add(seed.id, {
          group: "phrase",
          token: phrase.token,
          score: SIGNAL_WEIGHTS.strongPhrase,
        });
      }
    }

    const keywordHits = seed.keywords.filter((keyword) =>
      containsTokenRun(prepared.textStems, keyword.stems),
    );
    for (const keyword of keywordHits) {
      add(seed.id, {
        group: "keyword",
        token: keyword.token,
        score:
          keywordHits.length > 1
            ? SIGNAL_WEIGHTS.multipleKeywords
            : SIGNAL_WEIGHTS.singleKeyword,
      });
    }
  }

  return signals;
}

/**
 * The second level, once the category is settled.
 *
 * Same bar as the expense side: merchants and phrases only, no keyword tier,
 * and the result is dropped unless it clears `subcategoryMinScore`. Being sure
 * money is `refunds` says nothing about which of its five leaves it is.
 */
function subcategoryFor(
  category: IncomeCategory,
  prepared: PreparedText,
): { subcategory?: IncomeSubcategory; subcategoryConfidence?: number } {
  const compiled = COMPILED_SUBCATEGORIES.get(category);
  if (!compiled) return {};

  let best: { subcategory: IncomeSubcategory; confidence: number } | null =
    null;
  for (const rule of compiled) {
    let score = 0;

    for (const merchant of rule.merchants) {
      const matched = merchantScore(prepared.merchantTokens, merchant);
      if (matched !== null) score = Math.max(score, matched);
    }

    for (const phrase of rule.phrases) {
      if (containsTokenRun(prepared.textStems, phrase.stems)) {
        score = Math.max(score, SIGNAL_WEIGHTS.strongPhrase);
      }
    }

    if (score > (best?.confidence ?? 0)) {
      best = { subcategory: rule.id, confidence: score };
    }
  }

  if (!best || best.confidence < THRESHOLDS.subcategoryMinScore) return {};
  if (!isValidIncomeSubcategory(category, best.subcategory)) return {};
  return {
    subcategory: best.subcategory,
    subcategoryConfidence: round(best.confidence),
  };
}

/**
 * Classify an income from its description.
 *
 * Synchronous by design, like `classifyTransactionSync`: this runs on every
 * keystroke in the add-entry drawer and must never make the field wait.
 */
export function classifyIncomeSync(
  input: ClassifyTransactionInput,
): IncomeClassificationResult {
  const prepared = prepareText(input);
  const ranked = [...collectSignals(prepared)]
    .map(([category, signals]) => ({ category, ...combineSignals(signals) }))
    .filter((entry) => entry.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  const alternatives = (
    entries: typeof ranked,
  ): IncomeClassificationResult["alternatives"] =>
    entries.slice(0, MAX_ALTERNATIVES).map((entry) => ({
      category: entry.category,
      confidence: round(entry.confidence),
    }));

  const best = ranked[0];
  const runnerUp = ranked[1];

  if (!best || best.confidence < THRESHOLDS.suggestMinScore) {
    return {
      confidence: best ? round(best.confidence) : 0,
      decision: "needs_user_input",
      source: "fallback",
      alternatives: alternatives(ranked),
      normalizedMerchant: prepared.normalizedMerchant,
      signals: [],
    };
  }

  const margin = best.confidence - (runnerUp?.confidence ?? 0);
  const confident =
    best.confidence >= THRESHOLDS.autoAssignMinScore &&
    margin >= THRESHOLDS.autoAssignMinMargin;

  return {
    category: best.category,
    ...subcategoryFor(best.category, prepared),
    confidence: round(best.confidence),
    /*
     * Income *may* be auto-assigned, and the expense classifier's refusal to
     * do so is not an inconsistency. That rule exists because a transaction
     * whose direction it had to guess should never be filed silently as
     * spending. Here the direction is a fact the caller established, so a
     * confident rule is as trustworthy as it is on the expense side.
     */
    decision: confident ? "auto_assigned" : "suggested",
    source: best.source,
    alternatives: alternatives(ranked.slice(1)),
    normalizedMerchant: prepared.normalizedMerchant,
    signals: best.signals.map((signal) => `${signal.group}:${signal.token}`),
  };
}

/** Two decimals: these are ranks within one scale, not measurements. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
