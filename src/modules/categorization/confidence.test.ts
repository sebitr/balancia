import { describe, expect, it } from "vitest";
import {
  SIGNAL_WEIGHTS,
  THRESHOLDS,
  combineScores,
  combineSignals,
  dedupeSignals,
  type Signal,
} from "./confidence";

/**
 * The scoring rules, tested as rules rather than through the classifier: it
 * is much easier to see here that repetition buys nothing and that evidence
 * can never add up to certainty.
 */

const signal = (
  group: Signal["group"],
  token: string,
  score: number,
): Signal => ({ group, token, score });

describe("combineScores", () => {
  it("never reaches or exceeds one", () => {
    expect(combineScores([0.9, 0.9, 0.9, 0.9])).toBeLessThan(1);
    expect(combineScores([0.95, 0.95])).toBeCloseTo(0.9975, 4);
  });

  it("is monotonic and order-independent", () => {
    expect(combineScores([0.5, 0.3])).toBeCloseTo(
      combineScores([0.3, 0.5]),
      10,
    );
    expect(combineScores([0.5, 0.3])).toBeGreaterThan(combineScores([0.5]));
  });

  it("treats no evidence as no confidence", () => {
    expect(combineScores([])).toBe(0);
  });
});

describe("dedupeSignals", () => {
  it("drops a signal contained in a longer one from the same group", () => {
    const kept = dedupeSignals([
      signal("merchant", "uber eats", 0.95),
      signal("merchant", "uber", 0.95),
      signal("merchant", "eats", 0.45),
    ]);
    expect(kept.map((entry) => entry.token)).toEqual(["uber eats"]);
  });

  it("keeps the same word when it means different things", () => {
    const kept = dedupeSignals([
      signal("phrase", "restaurant", 0.9),
      signal("merchant", "restaurant", 0.95),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("collapses one phrase matched in several fields", () => {
    const kept = dedupeSignals([
      signal("phrase", "restaurant", 0.9),
      signal("phrase", "restaurant", 0.9),
      signal("phrase", "restaurant", 0.9),
    ]);
    expect(kept).toHaveLength(1);
  });
});

describe("combineSignals", () => {
  it("counts a group once, however often it fires", () => {
    const once = combineSignals([signal("phrase", "restaurant", 0.9)]);
    const thrice = combineSignals([
      signal("phrase", "restaurant", 0.9),
      signal("phrase", "restaurant", 0.9),
      signal("phrase", "restaurant", 0.9),
    ]);
    expect(thrice.confidence).toBeCloseTo(once.confidence, 10);
  });

  it("rates several different keywords above any single one", () => {
    const one = combineSignals([
      signal("keyword", "grill", SIGNAL_WEIGHTS.singleKeyword),
    ]);
    const two = combineSignals([
      signal("keyword", "grill", SIGNAL_WEIGHTS.singleKeyword),
      signal("keyword", "coffee", SIGNAL_WEIGHTS.singleKeyword),
    ]);
    expect(one.confidence).toBeCloseTo(SIGNAL_WEIGHTS.singleKeyword, 10);
    expect(two.confidence).toBeCloseTo(SIGNAL_WEIGHTS.multipleKeywords, 10);
  });

  it("names the strongest kind of evidence as the source", () => {
    expect(combineSignals([signal("learned", "group:migros", 1)]).source).toBe(
      "learned_mapping",
    );
    expect(combineSignals([signal("phrase", "cinema", 0.9)]).source).toBe(
      "phrase",
    );
    expect(
      combineSignals([
        signal("merchant", "pathe", 0.95),
        signal("phrase", "cinema", 0.9),
      ]).source,
    ).toBe("combined");
    // A learned mapping is the reason whatever else happened to match.
    expect(
      combineSignals([
        signal("learned", "group:pathe", 1),
        signal("phrase", "cinema", 0.9),
      ]).source,
    ).toBe("learned_mapping");
  });

  it("cannot turn the recurring bonus into a decision", () => {
    const alone = combineSignals([
      signal("recurring", "recurring", SIGNAL_WEIGHTS.recurringBonus),
    ]);
    expect(alone.confidence).toBeLessThan(THRESHOLDS.suggestMinScore);
  });
});
