import { describe, expect, it, vi } from "vitest";
import {
  SemanticClassifier,
  similarityToScore,
  SEMANTIC_TUNING,
} from "./semantic";
import { classifyTransaction } from "./classifier";
import { THRESHOLDS } from "./confidence";
import { CATEGORY_PROTOTYPES } from "./prototypes";
import type { Embedder } from "./semantic";

/**
 * The semantic layer, tested against a stand-in embedder.
 *
 * A real sentence model is optional, several hundred megabytes and not
 * deterministic enough to assert on. What must hold regardless of the model
 * is the *contract*: prototypes are embedded once, similarity is mapped onto
 * a bounded scale, the model alone never assigns a category, and a broken
 * embedder changes nothing.
 */

/**
 * Bag-of-words vectors over a fixed vocabulary. Crude, deterministic, and
 * enough to make "souper au restaurant" land near the restaurant prototypes.
 */
function bagOfWordsEmbedder(): Embedder & { calls: number } {
  const vocabulary = new Map<string, number>();
  const indexOf = (word: string): number => {
    const existing = vocabulary.get(word);
    if (existing !== undefined) return existing;
    const next = vocabulary.size;
    vocabulary.set(word, next);
    return next;
  };
  // Fixed width, so vectors stay comparable as the vocabulary grows.
  const WIDTH = 512;

  const embedder = {
    id: "test-bag-of-words",
    calls: 0,
    embed(texts: readonly string[]): Promise<readonly Float32Array[]> {
      embedder.calls += 1;
      return Promise.resolve(
        texts.map((text) => {
          const vector = new Float32Array(WIDTH);
          for (const word of text.toLowerCase().match(/[a-zà-ÿ]+/g) ?? []) {
            vector[indexOf(word) % WIDTH] += 1;
          }
          return vector;
        }),
      );
    },
  };
  return embedder;
}

describe("similarityToScore", () => {
  it("ignores similarity below the floor", () => {
    expect(similarityToScore(0)).toBe(0);
    expect(similarityToScore(SEMANTIC_TUNING.floor)).toBe(0);
  });

  it("rises to the cap and stops there", () => {
    expect(similarityToScore(SEMANTIC_TUNING.ceiling)).toBeCloseTo(
      SEMANTIC_TUNING.maxScore,
      10,
    );
    expect(similarityToScore(1)).toBeCloseTo(SEMANTIC_TUNING.maxScore, 10);
  });

  it("never reaches the auto-assign threshold on its own", () => {
    expect(SEMANTIC_TUNING.maxScore).toBeLessThan(
      THRESHOLDS.autoAssignMinScore,
    );
  });
});

describe("SemanticClassifier", () => {
  it("embeds the prototypes once, however many transactions it scores", async () => {
    const embedder = bagOfWordsEmbedder();
    const classifier = new SemanticClassifier(embedder);

    await classifier.score("restaurant");
    const afterFirst = embedder.calls;
    await classifier.score("supermarket");
    await classifier.score("hotel");

    // One call for the prototypes, then one per transaction.
    expect(afterFirst).toBe(2);
    expect(embedder.calls).toBe(4);
  });

  it("ranks the category whose prototypes the text resembles", async () => {
    const classifier = new SemanticClassifier(bagOfWordsEmbedder());
    const scores = await classifier.score("dîner au restaurant");
    expect(scores[0]?.category).toBe("restaurants");
  });

  it("has nothing to say about empty text", async () => {
    const classifier = new SemanticClassifier(bagOfWordsEmbedder());
    expect(await classifier.score("   ")).toEqual([]);
  });

  it("offers no prototypes for the fallback category", () => {
    expect(CATEGORY_PROTOTYPES.other).toBeUndefined();
  });
});

describe("classifyTransaction with a semantic pass", () => {
  it("does not run the model when the rules already decided", async () => {
    const embedder = bagOfWordsEmbedder();
    const semantic = new SemanticClassifier(embedder);

    const result = await classifyTransaction(
      { description: "MIGROS 1234" },
      { semantic },
    );
    expect(result.category).toBe("groceries");
    expect(result.source).toBe("merchant");
    expect(embedder.calls).toBe(0);
  });

  it("does not run the model when a mapping already decided", async () => {
    const embedder = bagOfWordsEmbedder();
    const semantic = new SemanticClassifier(embedder);

    await classifyTransaction(
      { description: "MIGROS 1234" },
      {
        semantic,
        mappings: [
          {
            scope: "group",
            rawMerchant: "MIGROS",
            normalizedMerchant: "migros",
            category: "restaurants",
            transactionType: null,
            correctionCount: 1,
            conflictCount: 0,
          },
        ],
      },
    );
    expect(embedder.calls).toBe(0);
  });

  it("adds a suggestion where the rules had none", async () => {
    const semantic = new SemanticClassifier(bagOfWordsEmbedder());
    const input = { description: "souper au restaurant chez Léa" };

    const withModel = await classifyTransaction(input, { semantic });
    expect(withModel.category).toBe("restaurants");
    expect(withModel.decision).not.toBe("needs_user_input");
  });

  it("keeps the deterministic answer when the model fails", async () => {
    const broken: Embedder = {
      id: "broken",
      embed: vi.fn().mockRejectedValue(new Error("model missing")),
    };
    const semantic = new SemanticClassifier(broken);

    const result = await classifyTransaction(
      { description: "AMAZON MARKETPLACE" },
      { semantic },
    );
    expect(result.category).toBe("shopping");
    expect(result.decision).toBe("suggested");
  });

  it("is identical to the deterministic pass with no embedder", async () => {
    const withNothing = await classifyTransaction({
      description: "Dinner at Migros",
    });
    expect(withNothing.decision).toBe("suggested");
    expect(withNothing.category).toBe("restaurants");
  });
});
