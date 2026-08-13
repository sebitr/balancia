import { describe, expect, it } from "vitest";
import {
  learnedEvidence,
  learningKeyFor,
  mappingConfidence,
  planCorrection,
  selectMapping,
} from "./learning";
import { SIGNAL_WEIGHTS } from "./confidence";
import type { LearnedMerchantMapping } from "./types";

/**
 * How the classifier remembers a correction — the part that has to be right
 * for it to get better instead of merely different.
 */

function mapping(
  overrides: Partial<LearnedMerchantMapping> = {},
): LearnedMerchantMapping {
  return {
    scope: "group",
    rawMerchant: "MIGROS 1234",
    normalizedMerchant: "migros",
    category: "groceries",
    transactionType: null,
    correctionCount: 1,
    conflictCount: 0,
    ...overrides,
  };
}

describe("learningKeyFor", () => {
  it("ignores the store number", () => {
    expect(learningKeyFor("migros 1234")).toBe("migros");
    expect(learningKeyFor("migros 5678")).toBe("migros");
  });

  it("has no key for an empty merchant", () => {
    expect(learningKeyFor("")).toBe("");
  });
});

describe("selectMapping", () => {
  it("finds the mapping for a merchant", () => {
    expect(selectMapping([mapping()], "migros 9999")?.category).toBe(
      "groceries",
    );
  });

  it("prefers the group's answer to the user's", () => {
    const chosen = selectMapping(
      [
        mapping({ scope: "user", category: "shopping" }),
        mapping({ scope: "group", category: "restaurants" }),
      ],
      "migros",
    );
    expect(chosen?.scope).toBe("group");
    expect(chosen?.category).toBe("restaurants");
  });

  it("falls back to the user's when the group has none", () => {
    const chosen = selectMapping(
      [mapping({ scope: "user", category: "shopping" })],
      "migros",
    );
    expect(chosen?.scope).toBe("user");
  });

  it("does not match a different merchant", () => {
    expect(selectMapping([mapping()], "carrefour")).toBeNull();
    expect(selectMapping([mapping()], "")).toBeNull();
  });
});

describe("mappingConfidence", () => {
  it("is complete for a mapping nobody has contradicted", () => {
    expect(mappingConfidence(mapping())).toBe(
      SIGNAL_WEIGHTS.learnedGroupMapping,
    );
  });

  it("drops while a change is still fresh", () => {
    expect(
      mappingConfidence(mapping({ correctionCount: 1, conflictCount: 1 })),
    ).toBe(SIGNAL_WEIGHTS.learnedConflicted);
  });

  it("recovers once the new answer is confirmed again", () => {
    expect(
      mappingConfidence(mapping({ correctionCount: 2, conflictCount: 1 })),
    ).toBe(SIGNAL_WEIGHTS.learnedGroupMapping);
  });
});

describe("learnedEvidence", () => {
  it("carries the mapping's own transaction type", () => {
    const evidence = learnedEvidence(
      [mapping({ transactionType: "refund" })],
      "migros 1234",
    );
    expect(evidence?.transactionType).toBe("refund");
    expect(evidence?.signal.group).toBe("learned");
  });

  it("is absent when nothing was taught", () => {
    expect(learnedEvidence([], "migros")).toBeNull();
  });
});

describe("planCorrection", () => {
  const base = {
    scope: "group" as const,
    rawMerchant: "MIGROS 1234",
    normalizedMerchant: "migros",
  };

  it("creates a mapping from the first choice", () => {
    expect(
      planCorrection({ ...base, category: "groceries", existing: null }),
    ).toMatchObject({
      category: "groceries",
      correctionCount: 1,
      conflictCount: 0,
    });
  });

  it("deepens a mapping that is confirmed again", () => {
    expect(
      planCorrection({
        ...base,
        category: "groceries",
        existing: {
          category: "groceries",
          correctionCount: 2,
          conflictCount: 0,
        },
      }),
    ).toMatchObject({ correctionCount: 3, conflictCount: 0 });
  });

  it("replaces a mapping that is contradicted, and starts counting again", () => {
    // The old agreement was evidence about the old answer, not the new one.
    expect(
      planCorrection({
        ...base,
        category: "restaurants",
        existing: {
          category: "groceries",
          correctionCount: 5,
          conflictCount: 0,
        },
      }),
    ).toMatchObject({
      category: "restaurants",
      correctionCount: 1,
      conflictCount: 1,
    });
  });
});
