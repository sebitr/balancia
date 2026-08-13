import { CATEGORY_PROTOTYPES } from "./prototypes";
import type { ExpenseCategory } from "./types";

/**
 * The semantic layer.
 *
 * Rules cannot cover `Souper chez Léa` or `weekly big shop`. Embeddings can,
 * because a multilingual sentence model puts those near `dîner au restaurant`
 * and `supermarket` without anyone writing either rule.
 *
 * Three properties matter more than accuracy here:
 *
 *  - **Optional.** `Embedder` is an interface. No embedder, no semantic pass,
 *    and the deterministic classifier answers alone. Nothing in the app waits
 *    for a model that may never be installed.
 *  - **Local.** The only implementation Balancia ships runs in the browser,
 *    against model files served by this instance. No transaction text ever
 *    leaves the machine it was typed on.
 *  - **Never certain.** Cosine similarity is not a probability. It is mapped
 *    through a deliberately conservative ramp that tops out below the
 *    auto-assign threshold, so the model can *suggest* on its own but only
 *    ever *decide* alongside other evidence.
 */

export interface Embedder {
  /** Identifies the model, so cached prototype vectors are never mixed. */
  readonly id: string;
  /** L2-normalized or not — `SemanticClassifier` normalizes either way. */
  embed(texts: readonly string[]): Promise<readonly Float32Array[]>;
}

export const SEMANTIC_TUNING = {
  /** Below this similarity the model is saying nothing useful. */
  floor: 0.35,
  /** At or above this similarity the model is as sure as it gets. */
  ceiling: 0.75,
  /**
   * The most a purely semantic match can ever score. Below
   * `THRESHOLDS.autoAssignMinScore` on purpose: a model that has never seen
   * this household's habits does not get to assign a category silently.
   */
  maxScore: 0.8,
} as const;

function normalizeVector(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) return vector;
  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1)
    normalized[i] = vector[i] / magnitude;
  return normalized;
}

/** Dot product of two already-normalized vectors. */
function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let total = 0;
  for (let i = 0; i < length; i += 1) total += a[i] * b[i];
  return total;
}

/**
 * Maps a raw similarity onto the classifier's scale.
 *
 * Linear between `floor` and `ceiling`, clamped at both ends, scaled by
 * `maxScore`. Documented and deterministic beats calibrated-looking: the
 * number is a rank within this system, not a probability of correctness.
 */
export function similarityToScore(similarity: number): number {
  const { floor, ceiling, maxScore } = SEMANTIC_TUNING;
  if (similarity <= floor) return 0;
  const ramp = Math.min((similarity - floor) / (ceiling - floor), 1);
  return ramp * maxScore;
}

export interface SemanticScore {
  readonly category: ExpenseCategory;
  readonly score: number;
  /** The prototype that matched best, for the explanation. */
  readonly prototype: string;
}

/**
 * Scores transaction text against the category prototypes.
 *
 * Prototype vectors are embedded once and kept for the life of the instance —
 * they never change, and re-embedding ~120 short strings per keystroke would
 * be the whole cost of the feature.
 */
export class SemanticClassifier {
  readonly #embedder: Embedder;
  #prototypes: Promise<readonly PrototypeVector[]> | null = null;

  constructor(embedder: Embedder) {
    this.#embedder = embedder;
  }

  async score(text: string): Promise<readonly SemanticScore[]> {
    const trimmed = text.trim();
    if (trimmed === "") return [];

    const prototypes = await this.#loadPrototypes();
    if (prototypes.length === 0) return [];

    const [raw] = await this.#embedder.embed([trimmed]);
    if (!raw) return [];
    const vector = normalizeVector(raw);

    const best = new Map<ExpenseCategory, SemanticScore>();
    for (const prototype of prototypes) {
      const score = similarityToScore(cosine(vector, prototype.vector));
      if (score <= 0) continue;
      const current = best.get(prototype.category);
      if (!current || score > current.score) {
        best.set(prototype.category, {
          category: prototype.category,
          score,
          prototype: prototype.text,
        });
      }
    }

    return [...best.values()].sort((a, b) => b.score - a.score);
  }

  #loadPrototypes(): Promise<readonly PrototypeVector[]> {
    this.#prototypes ??= embedPrototypes(this.#embedder);
    return this.#prototypes;
  }
}

interface PrototypeVector {
  readonly category: ExpenseCategory;
  readonly text: string;
  readonly vector: Float32Array;
}

async function embedPrototypes(
  embedder: Embedder,
): Promise<readonly PrototypeVector[]> {
  const entries = Object.entries(CATEGORY_PROTOTYPES) as [
    ExpenseCategory,
    readonly string[],
  ][];
  const flat = entries.flatMap(([category, texts]) =>
    texts.map((text) => ({ category, text })),
  );

  const vectors = await embedder.embed(flat.map((entry) => entry.text));
  return flat
    .map((entry, index) => {
      const vector = vectors[index];
      return vector ? { ...entry, vector: normalizeVector(vector) } : null;
    })
    .filter((entry): entry is PrototypeVector => entry !== null);
}
