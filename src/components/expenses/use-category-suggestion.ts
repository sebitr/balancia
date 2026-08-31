"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SemanticClassifier,
  classifyIncomeSync,
  classifyTransaction,
  classifyTransactionSync,
  type ClassificationResult,
  type LearnedMerchantMapping,
} from "@/modules/categorization";
import type { EntryDirection } from "@/modules/expenses/direction";
import { getBrowserEmbedder } from "@/lib/semantic/browser-embedder";

/**
 * Live category suggestion for the expense form.
 *
 * Two passes, and the first one is what the user actually sees:
 *
 *  1. The deterministic classifier runs synchronously on every (debounced)
 *     keystroke. It is string matching over pre-compiled rules — no awaiting,
 *     no network, and it already answers for any merchant Balancia knows.
 *  2. Only if that was not conclusive, and only if the operator installed the
 *     model, the semantic pass runs in a worker and may refine the answer.
 *
 * The form never waits for step 2, and an instance without the model never
 * reaches it.
 */

/** Long enough not to reclassify mid-word, short enough to feel live. */
const DEBOUNCE_MS = 250;

/**
 * What the form needs from either classifier.
 *
 * The two return different category types — they are different vocabularies —
 * and the form's business is a code and a decision. Narrowing to what both
 * agree on is what lets one row show either.
 */
export interface CategorySuggestion {
  readonly category?: string;
  readonly subcategory?: string;
  readonly decision: ClassificationResult["decision"];
  readonly confidence: number;
  /** The runners-up, for the shortlist. At most three, best first. */
  readonly alternatives: readonly {
    readonly category: string;
    readonly confidence: number;
  }[];
}

/**
 * One classifier per tab: the prototype vectors are embedded on first use and
 * reused for every expense afterwards.
 */
let sharedSemantic: Promise<SemanticClassifier | null> | null = null;

function getSemanticClassifier(): Promise<SemanticClassifier | null> {
  sharedSemantic ??= getBrowserEmbedder().then((embedder) =>
    embedder ? new SemanticClassifier(embedder) : null,
  );
  return sharedSemantic;
}

export function useCategorySuggestion(options: {
  description: string;
  notes: string;
  recurring?: boolean;
  mappings: readonly LearnedMerchantMapping[];
  semanticEnabled: boolean;
  /**
   * Which vocabulary to classify into. Absent means spending.
   *
   * Income takes a different pipeline entirely — see `income-classifier` —
   * rather than the same one with a flag. It has no learned mappings and no
   * semantic pass: `expense_category_mappings` has no direction column, and
   * the prototype vectors describe spending, so consulting either would be
   * the mistake the second vocabulary exists to prevent.
   */
  direction?: EntryDirection;
}): CategorySuggestion | null {
  const {
    description,
    notes,
    recurring,
    mappings,
    semanticEnabled,
    direction,
  } = options;
  const incoming = direction === "in";

  const [debounced, setDebounced] = useState({ description, notes });
  useEffect(() => {
    const timer = setTimeout(
      () => setDebounced({ description, notes }),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [description, notes]);

  const input = useMemo(
    () => ({
      description: debounced.description,
      note: debounced.notes,
      recurring,
    }),
    [debounced, recurring],
  );

  const deterministic = useMemo((): CategorySuggestion | null => {
    if (input.description.trim() === "") return null;
    return incoming
      ? classifyIncomeSync(input)
      : classifyTransactionSync(input, { mappings });
  }, [input, mappings, incoming]);

  /**
   * Tagged with the input it describes rather than cleared on change: a stale
   * refinement is then simply ignored during render, and the effect never has
   * to reset state synchronously.
   */
  const [refined, setRefined] = useState<{
    key: object;
    result: ClassificationResult;
  } | null>(null);

  useEffect(() => {
    if (
      incoming ||
      !semanticEnabled ||
      !deterministic ||
      deterministic.decision === "auto_assigned"
    ) {
      return;
    }

    let cancelled = false;
    void getSemanticClassifier()
      .then((semantic) =>
        semantic ? classifyTransaction(input, { mappings, semantic }) : null,
      )
      .then((result) => {
        if (!cancelled && result) setRefined({ key: input, result });
      })
      // An unavailable or failing model is a supported state, not an error to
      // report: the deterministic answer is already on screen.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [input, mappings, semanticEnabled, deterministic, incoming]);

  return (refined?.key === input ? refined.result : null) ?? deterministic;
}
