import { SIGNAL_WEIGHTS, type Signal } from "./confidence";
import {
  containsTokenRun,
  indexOfTokenRun,
  isIdentifyingPrefix,
  normalizeMerchant,
  singularize,
  stripStructuredNoise,
  tokenize,
} from "./normalize";
import { contextualOverrides } from "./overrides";
import {
  CATEGORY_SEEDS,
  SUBCATEGORY_SEEDS,
  allPhrases,
  type CategorySeed,
  type SubcategorySeed,
} from "./seeds";
import type {
  ClassifyTransactionInput,
  ExpenseCategory,
  ExpenseSubcategory,
} from "./types";

/**
 * The deterministic pass: rules only, no model, no I/O.
 *
 * It is the whole classifier on a self-hosted instance that never installs
 * the optional embedding model, and it is the fast path on one that does —
 * everything here is string comparison over pre-compiled token arrays.
 */

/** A merchant rule long enough to be a name rather than a coincidence. */
const DISTINCTIVE_TOKEN_LENGTH = 5;

interface CompiledPhrase {
  /** Normalized form, used as the signal's explanation and dedupe key. */
  readonly token: string;
  readonly tokens: readonly string[];
  /**
   * The same tokens singularised, for matching against text.
   *
   * Only phrases, keywords and excludes are compared this way. Merchants are
   * matched on `tokens`, because a brand is a name and `migros` is not the
   * plural of anything.
   */
  readonly stems: readonly string[];
}

interface CompiledSeed {
  readonly id: ExpenseCategory;
  readonly merchants: readonly CompiledPhrase[];
  readonly fragments: readonly CompiledPhrase[];
  readonly ambiguous: readonly CompiledPhrase[];
  readonly phrases: readonly CompiledPhrase[];
  readonly keywords: readonly CompiledPhrase[];
  readonly excludes: readonly CompiledPhrase[];
}

/** Merchant rules go through the same normalization as the input they meet. */
function compileMerchant(value: string): CompiledPhrase {
  const { normalizedMerchant } = normalizeMerchant(value);
  const tokens = tokenize(normalizedMerchant);
  return { token: normalizedMerchant, tokens, stems: tokens };
}

function compilePhrase(value: string): CompiledPhrase {
  const tokens = tokenize(value);
  return { token: tokens.join(" "), tokens, stems: tokens.map(singularize) };
}

function compileSeed(seed: CategorySeed): CompiledSeed {
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

function nonEmpty(phrase: CompiledPhrase): boolean {
  return phrase.tokens.length > 0;
}

/** Compiled once: the seed data never changes at runtime. */
const COMPILED_SEEDS: readonly CompiledSeed[] = CATEGORY_SEEDS.map(compileSeed);

export interface PreparedText {
  readonly rawMerchant: string;
  readonly normalizedMerchant: string;
  readonly merchantTokens: readonly string[];
  /** Merchant, description, note and receipt text, tokenized together. */
  readonly textTokens: readonly string[];
  /** The same tokens singularised, so `pizzas` meets the rule for `pizza`. */
  readonly textStems: readonly string[];
  readonly processor: string | null;
  readonly processorOnly: boolean;
  /** Free text for the semantic pass, with identifiers already removed. */
  readonly semanticText: string;
}

/**
 * Assembles the text the classifier is allowed to look at.
 *
 * Only fields that describe the purchase: no participant names, no IDs, no
 * card numbers. What is not here cannot leak into an embedding or a log.
 */
export function prepareText(input: ClassifyTransactionInput): PreparedText {
  const merchantSource = input.merchant?.trim() || input.description || "";
  const normalized = normalizeMerchant(merchantSource);

  const parts = [
    input.description,
    input.note,
    input.receipt?.merchant,
    input.receipt?.itemNames?.join(" "),
    input.receipt?.rawText,
  ].filter((part): part is string => Boolean(part && part.trim()));

  // For matching: the description usually *is* the merchant, so running it
  // through the same normalization keeps `CB NETFLIX.COM 12/05` from
  // contributing a date.
  const matchable = [normalized.normalizedMerchant, ...parts].map(
    (part) => normalizeMerchant(part).normalizedMerchant || part,
  );

  // For the model: identifiers removed, but accents, case and word order left
  // alone — that is what a multilingual sentence encoder is good at.
  const semantic = parts
    .map(stripStructuredNoise)
    .filter((part) => part !== "");

  const textTokens = tokenize(matchable.join(" "));

  return {
    rawMerchant: merchantSource,
    normalizedMerchant: normalized.normalizedMerchant,
    merchantTokens: tokenize(normalized.normalizedMerchant),
    textTokens,
    textStems: textTokens.map(singularize),
    processor: normalized.processor,
    processorOnly: normalized.processorOnly,
    semanticText: [...new Set(semantic)].join(" | "),
  };
}

export interface DeterministicEvidence {
  /** Freshly built per call, and the caller may add to it. */
  readonly signals: Map<ExpenseCategory, Signal[]>;
  readonly prepared: PreparedText;
}

/**
 * Scores every category against the seed rules and the contextual overrides.
 *
 * Returns raw signals rather than a decision: learned mappings and the
 * semantic pass add their own before anything is ranked.
 */
export function collectDeterministicSignals(
  input: ClassifyTransactionInput,
  prepared: PreparedText = prepareText(input),
): DeterministicEvidence {
  const signals = new Map<ExpenseCategory, Signal[]>();
  const add = (category: ExpenseCategory, signal: Signal): void => {
    const bucket = signals.get(category);
    if (bucket) bucket.push(signal);
    else signals.set(category, [signal]);
  };

  const overrides = contextualOverrides({
    merchant: prepared.merchantTokens,
    text: prepared.textTokens,
  });
  const suppressed = new Set<ExpenseCategory>();
  for (const override of overrides) {
    add(override.category, {
      group: "override",
      token: override.token,
      score: SIGNAL_WEIGHTS.contextualOverride,
    });
    for (const category of override.suppress) suppressed.add(category);
  }
  // An override never suppresses the category it just chose.
  for (const override of overrides) suppressed.delete(override.category);

  for (const seed of COMPILED_SEEDS) {
    if (suppressed.has(seed.id)) continue;

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
      if (containsTokenRun(prepared.merchantTokens, ambiguous.tokens)) {
        add(seed.id, {
          group: "merchant",
          token: ambiguous.token,
          score: SIGNAL_WEIGHTS.ambiguousMerchant,
        });
      }
    }

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

    for (const keyword of seed.keywords) {
      if (containsTokenRun(prepared.textStems, keyword.stems)) {
        add(seed.id, {
          group: "keyword",
          token: keyword.token,
          score: SIGNAL_WEIGHTS.singleKeyword,
        });
      }
    }
  }

  // Repetition leans towards a subscription without ever deciding one: on its
  // own 0.15 is far below every threshold.
  if (input.recurring && !suppressed.has("subscriptions")) {
    add("subscriptions", {
      group: "recurring",
      token: "recurring",
      score: SIGNAL_WEIGHTS.recurringBonus,
    });
  }

  return { signals, prepared };
}

/**
 * How strongly a merchant rule matches, or null.
 *
 *  - opening the descriptor, with only noise after it → it is the merchant
 *  - a multi-word rule anywhere in it → the same family
 *  - a long, distinctive single word anywhere in it → the same family
 *
 * A short word appearing mid-descriptor is deliberately nothing: `bp` and
 * `max` occur inside ordinary sentences.
 */
function merchantScore(
  merchantTokens: readonly string[],
  rule: CompiledPhrase,
): number | null {
  if (merchantTokens.length === 0) return null;
  if (isIdentifyingPrefix(merchantTokens, rule.tokens)) {
    return SIGNAL_WEIGHTS.exactMerchant;
  }
  if (indexOfTokenRun(merchantTokens, rule.tokens) === -1) return null;
  if (rule.tokens.length > 1) return SIGNAL_WEIGHTS.merchantFamily;
  return rule.token.length >= DISTINCTIVE_TOKEN_LENGTH
    ? SIGNAL_WEIGHTS.merchantFamily
    : null;
}

/**
 * The second level: which subcategory of an already-decided category, if any.
 *
 * Deliberately not part of `collectDeterministicSignals`. Subcategories are
 * not ranked against each other across categories and never compete with it —
 * the category is settled first, by whatever means (a rule, a learned mapping,
 * the semantic pass), and only then is this asked about *that* category. So it
 * scores at most a dozen rules instead of a hundred and twenty-six, and a
 * strong `fuel` match can never drag a transaction away from `groceries`.
 *
 * Returns the best match and its score, or null. Only merchants and phrases
 * count, at their usual weights; there is no keyword tier, and no fallback to
 * "the first subcategory in the list".
 */
export function detectSubcategory(
  category: ExpenseCategory,
  prepared: PreparedText,
): { subcategory: ExpenseSubcategory; confidence: number } | null {
  const compiled = COMPILED_SUBCATEGORIES.get(category);
  if (!compiled) return null;

  let best: { subcategory: ExpenseSubcategory; confidence: number } | null =
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

  return best;
}

interface CompiledSubcategory {
  readonly id: ExpenseSubcategory;
  readonly merchants: readonly CompiledPhrase[];
  readonly phrases: readonly CompiledPhrase[];
}

/** Compiled once, like the category seeds. */
const COMPILED_SUBCATEGORIES: ReadonlyMap<
  ExpenseCategory,
  readonly CompiledSubcategory[]
> = new Map(
  Object.entries(SUBCATEGORY_SEEDS).map(([category, rules]) => [
    category as ExpenseCategory,
    (rules as readonly SubcategorySeed[]).map((rule) => ({
      id: rule.id,
      merchants: (rule.merchants ?? []).map(compileMerchant).filter(nonEmpty),
      phrases: allPhrases(rule.phrases).map(compilePhrase).filter(nonEmpty),
    })),
  ]),
);
