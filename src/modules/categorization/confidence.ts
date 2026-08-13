import type { ClassificationSource } from "./types";

/**
 * Scoring.
 *
 * Two rules keep the numbers honest.
 *
 * **Signals are grouped, and a group counts once.** `restaurant restaurant
 * restaurant` is one piece of evidence about one transaction, not three, and
 * `uber eats` must not also collect credit for `uber` and for `eats`. Every
 * signal declares the group it belongs to; the group contributes its strongest
 * member and nothing more.
 *
 * **Groups combine with noisy-OR, never by addition.** Independent evidence
 * should reinforce without ever reaching certainty:
 *
 *     combined = 1 − Π (1 − score)
 *
 * Two 0.9 signals give 0.99, not 1.8. The result stays inside [0, 1) whatever
 * is thrown at it, so thresholds mean the same thing forever.
 */

export const SIGNAL_WEIGHTS = {
  /** Someone in this group taught us this merchant. */
  learnedGroupMapping: 1.0,
  /** This user taught us this merchant, in any of their groups. */
  learnedUserMapping: 1.0,
  /** A mapping that was recently overwritten with a different category. */
  learnedConflicted: 0.9,
  contextualOverride: 0.95,
  exactMerchant: 0.95,
  strongPhrase: 0.9,
  merchantFamily: 0.85,
  multipleKeywords: 0.75,
  /** A brand that sells across categories: enough to suggest, never to decide. */
  ambiguousMerchant: 0.55,
  singleKeyword: 0.45,
  /** Repeating charges lean towards subscriptions. Never sufficient alone. */
  recurringBonus: 0.15,
} as const;

export const THRESHOLDS = {
  autoAssignMinScore: 0.82,
  /** How far ahead of the runner-up the winner must be to be applied silently. */
  autoAssignMinMargin: 0.12,
  suggestMinScore: 0.55,
} as const;

/** How many suggestions a caller is ever offered. */
export const MAX_ALTERNATIVES = 3;

export type SignalGroup =
  | "learned"
  | "override"
  | "merchant"
  | "phrase"
  | "keyword"
  | "semantic"
  | "recurring";

export interface Signal {
  readonly group: SignalGroup;
  /**
   * What matched, normalized — `migros`, `billet de train`. Doubles as the
   * de-duplication key and as the human-readable explanation.
   */
  readonly token: string;
  readonly score: number;
}

/** The source reported for a category, strongest group first. */
const SOURCE_BY_GROUP: Readonly<Record<SignalGroup, ClassificationSource>> = {
  learned: "learned_mapping",
  override: "contextual_override",
  merchant: "merchant",
  phrase: "phrase",
  keyword: "keyword",
  semantic: "semantic",
  recurring: "keyword",
};

const GROUP_PRIORITY: readonly SignalGroup[] = [
  "learned",
  "override",
  "merchant",
  "phrase",
  "semantic",
  "keyword",
  "recurring",
];

/**
 * Drops signals whose token is contained in another signal of the same group.
 *
 * This is what stops `uber eats` from also scoring as `uber` and as `eats`:
 * the longest thing that matched is the thing that matched.
 */
export function dedupeSignals(signals: readonly Signal[]): Signal[] {
  const kept: Signal[] = [];
  for (const signal of signals) {
    const subsumed = signals.some(
      (other) =>
        other !== signal &&
        other.group === signal.group &&
        other.token.length > signal.token.length &&
        ` ${other.token} `.includes(` ${signal.token} `),
    );
    if (subsumed) continue;
    // Identical tokens can arrive from several fields; keep the first.
    if (
      kept.some(
        (existing) =>
          existing.group === signal.group && existing.token === signal.token,
      )
    ) {
      continue;
    }
    kept.push(signal);
  }
  return kept;
}

/**
 * One score per group.
 *
 * Every group contributes its strongest signal, except keywords: several
 * *different* weak words are worth more together than the best of them alone,
 * which is exactly the "multiple keywords" tier.
 */
function scoreByGroup(signals: readonly Signal[]): Map<SignalGroup, number> {
  const scores = new Map<SignalGroup, number>();
  for (const signal of signals) {
    const current = scores.get(signal.group) ?? 0;
    scores.set(signal.group, Math.max(current, signal.score));
  }

  const distinctKeywords = new Set(
    signals.filter((signal) => signal.group === "keyword").map((s) => s.token),
  ).size;
  if (distinctKeywords > 1) {
    scores.set(
      "keyword",
      Math.max(scores.get("keyword") ?? 0, SIGNAL_WEIGHTS.multipleKeywords),
    );
  }
  return scores;
}

/** Noisy-OR: independent evidence reinforces, and never reaches 1. */
export function combineScores(scores: Iterable<number>): number {
  let remaining = 1;
  for (const score of scores) {
    remaining *= 1 - Math.min(Math.max(score, 0), 1);
  }
  return 1 - remaining;
}

export interface CombinedScore {
  readonly confidence: number;
  readonly source: ClassificationSource;
  readonly signals: readonly Signal[];
}

/** Collapses one category's evidence into a single bounded confidence. */
export function combineSignals(signals: readonly Signal[]): CombinedScore {
  const kept = dedupeSignals(signals);
  const byGroup = scoreByGroup(kept);
  const confidence = combineScores(byGroup.values());

  const strongest = GROUP_PRIORITY.find((group) => byGroup.has(group));
  if (strongest === undefined) {
    return { confidence, source: "fallback", signals: kept };
  }

  // A learned mapping or an explicit override *is* the reason, whatever else
  // happened to match. Below those, several kinds of evidence make "combined"
  // the honest answer.
  const decisive = strongest === "learned" || strongest === "override";
  const contributingGroups = [...byGroup].filter(
    ([, score]) => score > 0,
  ).length;

  return {
    confidence,
    source:
      decisive || contributingGroups === 1
        ? SOURCE_BY_GROUP[strongest]
        : "combined",
    signals: kept,
  };
}

/** Renders a signal the way it appears in `ClassificationResult.signals`. */
export function describeSignal(signal: Signal): string {
  return `${signal.group}:${signal.token}`;
}
