import { SIGNAL_WEIGHTS, type Signal } from "./confidence";
import { merchantKey } from "./normalize";
import type {
  ExpenseCategory,
  ExpenseSubcategory,
  LearnedMerchantMapping,
  MappingScope,
  TransactionType,
} from "./types";

/**
 * Learned merchant mappings.
 *
 * The classifier gets better by remembering what people chose, not by
 * retraining anything. A correction is one row; the next transaction from the
 * same merchant reads it back and wins outright.
 *
 * This file is pure — selecting, scoring and planning updates. Reading and
 * writing rows is `service.ts`, so all of this can be unit-tested without a
 * database and reused in the browser.
 *
 * Scope precedence follows the matching priority: a group's mapping beats an
 * individual's, because inside a group the group's habit is what the expense
 * belongs to. When a group mapping exists, the user's is not consulted at all
 * — otherwise a disagreement would show up as two categories at 1.0 and no
 * margin between them.
 */

/** Everything needed to look a mapping up, derived once per classification. */
export function learningKeyFor(normalizedMerchant: string): string {
  return merchantKey(normalizedMerchant);
}

/**
 * A mapping someone has since replaced is worth slightly less than one that
 * has only ever been confirmed — "conflicting corrections reduce certainty".
 */
export function mappingConfidence(
  mapping: Pick<
    LearnedMerchantMapping,
    "scope" | "correctionCount" | "conflictCount"
  >,
): number {
  if (mapping.conflictCount > 0 && mapping.correctionCount < 2) {
    return SIGNAL_WEIGHTS.learnedConflicted;
  }
  return mapping.scope === "group"
    ? SIGNAL_WEIGHTS.learnedGroupMapping
    : SIGNAL_WEIGHTS.learnedUserMapping;
}

/** The mapping that applies to this merchant, or null. */
export function selectMapping(
  mappings: readonly LearnedMerchantMapping[],
  normalizedMerchant: string,
): LearnedMerchantMapping | null {
  const key = learningKeyFor(normalizedMerchant);
  if (key === "") return null;

  const matches = mappings.filter(
    (mapping) => mapping.normalizedMerchant === key,
  );
  if (matches.length === 0) return null;

  return (
    matches.find((mapping) => mapping.scope === "group") ?? matches[0] ?? null
  );
}

export interface LearnedEvidence {
  readonly category: ExpenseCategory;
  /** The subcategory taught with it, when there was one. */
  readonly subcategory: ExpenseSubcategory | null;
  readonly transactionType: TransactionType | null;
  readonly signal: Signal;
}

/** The signal a learned mapping contributes, if one applies. */
export function learnedEvidence(
  mappings: readonly LearnedMerchantMapping[],
  normalizedMerchant: string,
): LearnedEvidence | null {
  const mapping = selectMapping(mappings, normalizedMerchant);
  if (!mapping) return null;

  return {
    category: mapping.category,
    subcategory: mapping.subcategory ?? null,
    transactionType: mapping.transactionType ?? null,
    signal: {
      group: "learned",
      token: `${mapping.scope}:${mapping.normalizedMerchant}`,
      score: mappingConfidence(mapping),
    },
  };
}

export interface CorrectionPlan {
  readonly scope: MappingScope;
  readonly rawMerchant: string;
  readonly normalizedMerchant: string;
  readonly category: ExpenseCategory;
  readonly correctionCount: number;
  readonly conflictCount: number;
}

/**
 * What to store after someone picks a category.
 *
 * Confirming the same choice deepens the mapping; picking a different one
 * replaces it and records that it changed. The count resets on a change
 * because the old agreement is evidence about the old answer, not the new
 * one.
 */
export function planCorrection(options: {
  scope: MappingScope;
  rawMerchant: string;
  normalizedMerchant: string;
  category: ExpenseCategory;
  existing?: Pick<
    LearnedMerchantMapping,
    "category" | "correctionCount" | "conflictCount"
  > | null;
}): CorrectionPlan {
  const { scope, rawMerchant, normalizedMerchant, category, existing } =
    options;
  const base = { scope, rawMerchant, normalizedMerchant, category };

  if (!existing) {
    return { ...base, correctionCount: 1, conflictCount: 0 };
  }
  if (existing.category === category) {
    return {
      ...base,
      correctionCount: existing.correctionCount + 1,
      conflictCount: existing.conflictCount,
    };
  }
  return {
    ...base,
    correctionCount: 1,
    conflictCount: existing.conflictCount + 1,
  };
}
