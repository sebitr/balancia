"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SemanticClassifier,
  classifyTransaction,
  classifyTransactionSync,
  type ClassificationResult,
  type LearnedMerchantMapping,
} from "@/modules/categorization";
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
}): ClassificationResult | null {
  const { description, notes, recurring, mappings, semanticEnabled } = options;

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

  const deterministic = useMemo(
    () =>
      input.description.trim() === ""
        ? null
        : classifyTransactionSync(input, { mappings }),
    [input, mappings],
  );

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
  }, [input, mappings, semanticEnabled, deterministic]);

  return (refined?.key === input ? refined.result : null) ?? deterministic;
}
