import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { AllocationError } from "./allocation";
import {
  convertAllocations,
  resolveSplit,
  validatePayerContributions,
  type SplitInput,
} from "./split";

const sumAllocations = (allocations: readonly { amount: bigint }[]): bigint =>
  allocations.reduce((accumulator, entry) => accumulator + entry.amount, 0n);

describe("resolveSplit — equal", () => {
  it("splits evenly and reports no rounding", () => {
    const result = resolveSplit(3000n, {
      method: "equal",
      entries: [
        { participantId: "a" },
        { participantId: "b" },
        { participantId: "c" },
      ],
    });
    expect(result.allocations.map((entry) => entry.amount)).toEqual([
      1000n,
      1000n,
      1000n,
    ]);
    expect(result.rounding.adjustedUnits).toBe(0n);
  });

  it("surfaces the rounding difference when the total does not divide", () => {
    const result = resolveSplit(1000n, {
      method: "equal",
      entries: [
        { participantId: "a" },
        { participantId: "b" },
        { participantId: "c" },
      ],
    });
    expect(result.allocations.map((entry) => entry.amount)).toEqual([
      334n,
      333n,
      333n,
    ]);
    expect(result.rounding).toEqual({ adjustedCount: 1, adjustedUnits: 1n });
  });
});

describe("resolveSplit — exact", () => {
  it("uses the supplied amounts verbatim", () => {
    const result = resolveSplit(1000n, {
      method: "exact",
      entries: [
        { participantId: "a", value: "700" },
        { participantId: "b", value: "300" },
      ],
    });
    expect(result.allocations).toEqual([
      { participantId: "a", amount: 700n },
      { participantId: "b", amount: 300n },
    ]);
  });

  it("rejects amounts that do not sum to the total", () => {
    expect(() =>
      resolveSplit(1000n, {
        method: "exact",
        entries: [
          { participantId: "a", value: "700" },
          { participantId: "b", value: "299" },
        ],
      }),
    ).toThrow(AllocationError);
  });

  it("rejects non-integer input (minor units only)", () => {
    expect(() =>
      resolveSplit(1000n, {
        method: "exact",
        entries: [
          { participantId: "a", value: "7.00" },
          { participantId: "b", value: "300" },
        ],
      }),
    ).toThrow(AllocationError);
  });

  it("rejects a part too large to store, even when the parts add up", () => {
    // Only the sum is held to the total, so these two passed and the first
    // then overflowed the `bigint` column it was written to — a 500.
    const huge = (10n ** 30n).toString();
    const refusal = (() => {
      try {
        resolveSplit(1000n, {
          method: "exact",
          entries: [
            { participantId: "a", value: huge },
            {
              participantId: "b",
              value: `-${(10n ** 30n - 1000n).toString()}`,
            },
          ],
        });
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(refusal).toBeInstanceOf(AllocationError);
    expect((refusal as AllocationError).code).toBe("valueTooLarge");
  });

  it("still carries a credit, as a receipt with a discount produces", () => {
    // The sign is left alone on purpose: a discount larger than one person's
    // items leaves them owed, and the receipt split hands the engine that.
    const result = resolveSplit(1000n, {
      method: "exact",
      entries: [
        { participantId: "a", value: "1200" },
        { participantId: "b", value: "-200" },
      ],
    });
    expect(result.allocations.map((entry) => entry.amount)).toEqual([
      1200n,
      -200n,
    ]);
  });
});

describe("resolveSplit — percentage", () => {
  it("allocates by percentage and absorbs rounding deterministically", () => {
    const result = resolveSplit(1000n, {
      method: "percentage",
      entries: [
        { participantId: "a", value: "33.33" },
        { participantId: "b", value: "33.33" },
        { participantId: "c", value: "33.34" },
      ],
    });
    expect(sumAllocations(result.allocations)).toBe(1000n);
    expect(result.allocations.map((entry) => entry.amount)).toEqual([
      333n,
      333n,
      334n,
    ]);
  });

  it("rejects percentages that do not total 100", () => {
    expect(() =>
      resolveSplit(1000n, {
        method: "percentage",
        entries: [
          { participantId: "a", value: "50" },
          { participantId: "b", value: "49.99" },
        ],
      }),
    ).toThrow(AllocationError);
  });

  it("handles a zero-decimal currency total", () => {
    const result = resolveSplit(101n, {
      method: "percentage",
      entries: [
        { participantId: "a", value: "50" },
        { participantId: "b", value: "50" },
      ],
    });
    expect(sumAllocations(result.allocations)).toBe(101n);
    expect(result.allocations.map((entry) => entry.amount)).toEqual([51n, 50n]);
  });
});

describe("resolveSplit — shares", () => {
  it("allocates by weight", () => {
    const result = resolveSplit(10000n, {
      method: "shares",
      entries: [
        { participantId: "a", value: "2" },
        { participantId: "b", value: "1" },
        { participantId: "c", value: "1" },
      ],
    });
    expect(result.allocations.map((entry) => entry.amount)).toEqual([
      5000n,
      2500n,
      2500n,
    ]);
  });

  it("supports fractional weights and indivisible totals", () => {
    const result = resolveSplit(1000n, {
      method: "shares",
      entries: [
        { participantId: "a", value: "1.5" },
        { participantId: "b", value: "1" },
        { participantId: "c", value: "0.5" },
      ],
    });
    expect(sumAllocations(result.allocations)).toBe(1000n);
    expect(result.allocations.map((entry) => entry.amount)).toEqual([
      500n,
      333n,
      167n,
    ]);
  });

  it("rejects a split where every share is zero", () => {
    expect(() =>
      resolveSplit(1000n, {
        method: "shares",
        entries: [
          { participantId: "a", value: "0" },
          { participantId: "b", value: "0" },
        ],
      }),
    ).toThrow(AllocationError);
  });
});

describe("resolveSplit — structural validation", () => {
  it("rejects an empty participant list", () => {
    expect(() => resolveSplit(1000n, { method: "equal", entries: [] })).toThrow(
      AllocationError,
    );
  });

  it("rejects duplicate participants", () => {
    expect(() =>
      resolveSplit(1000n, {
        method: "equal",
        entries: [{ participantId: "a" }, { participantId: "a" }],
      }),
    ).toThrow(AllocationError);
  });

  it("always produces allocations summing to the total, for every method", () => {
    const methods: SplitInput["method"][] = ["equal", "percentage", "shares"];
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 10n }),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom(...methods),
        (total, count, method) => {
          const entries = Array.from({ length: count }, (_, index) => {
            if (method === "equal") {
              return { participantId: `p${index}` };
            }
            if (method === "percentage") {
              // Distribute 100 across `count` participants exactly.
              const base = Math.floor(10000 / count);
              const remainder = 10000 - base * count;
              const points = index === 0 ? base + remainder : base;
              return {
                participantId: `p${index}`,
                value: (points / 100).toFixed(2),
              };
            }
            return { participantId: `p${index}`, value: String(index + 1) };
          });
          const result = resolveSplit(total, { method, entries });
          expect(sumAllocations(result.allocations)).toBe(total);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("validatePayerContributions", () => {
  it("accepts a single payer covering the whole expense", () => {
    expect(() =>
      validatePayerContributions(1000n, [
        { participantId: "a", amount: 1000n },
      ]),
    ).not.toThrow();
  });

  it("accepts several payers covering the expense together", () => {
    expect(() =>
      validatePayerContributions(1000n, [
        { participantId: "a", amount: 600n },
        { participantId: "b", amount: 400n },
      ]),
    ).not.toThrow();
  });

  it("rejects contributions that miss the total", () => {
    expect(() =>
      validatePayerContributions(1000n, [
        { participantId: "a", amount: 600n },
        { participantId: "b", amount: 300n },
      ]),
    ).toThrow(AllocationError);
  });

  it("rejects duplicate payers, negative contributions and empty payer lists", () => {
    expect(() =>
      validatePayerContributions(1000n, [
        { participantId: "a", amount: 500n },
        { participantId: "a", amount: 500n },
      ]),
    ).toThrow(AllocationError);
    expect(() =>
      validatePayerContributions(1000n, [
        { participantId: "a", amount: 1100n },
        { participantId: "b", amount: -100n },
      ]),
    ).toThrow(AllocationError);
    expect(() => validatePayerContributions(1000n, [])).toThrow(
      AllocationError,
    );
  });
});

describe("convertAllocations", () => {
  it("keeps converted parts summing to the converted total", () => {
    const allocations = [
      { participantId: "a", amount: 334n },
      { participantId: "b", amount: 333n },
      { participantId: "c", amount: 333n },
    ];
    // 10.00 EUR -> 11.03 USD
    const converted = convertAllocations(allocations, 1103n, 1000n);
    expect(sumAllocations(converted)).toBe(1103n);
  });

  it("handles a zero-value expense", () => {
    const converted = convertAllocations(
      [
        { participantId: "a", amount: 0n },
        { participantId: "b", amount: 0n },
      ],
      0n,
      0n,
    );
    expect(converted.every((entry) => entry.amount === 0n)).toBe(true);
  });

  it("preserves the sum for arbitrary conversions", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.bigInt({ min: 0n, max: 10n ** 8n }), {
            minLength: 1,
            maxLength: 15,
          })
          .filter((parts) => parts.some((part) => part > 0n)),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        (parts, convertedTotal) => {
          const originalTotal = parts.reduce(
            (accumulator, part) => accumulator + part,
            0n,
          );
          const allocations = parts.map((amount, index) => ({
            participantId: `p${index}`,
            amount,
          }));
          const converted = convertAllocations(
            allocations,
            convertedTotal,
            originalTotal,
          );
          expect(sumAllocations(converted)).toBe(convertedTotal);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("refuses a credit whose converted parts no longer fit", () => {
    // Parts of both signs each outgrow the total they cancel down to, so a
    // converted total inside the line says nothing about them.
    const allocations = [
      { participantId: "a", amount: 10n ** 17n + 1000n },
      { participantId: "b", amount: -(10n ** 17n) },
    ];
    expect(() => convertAllocations(allocations, 1_000_000n, 1000n)).toThrow(
      AllocationError,
    );
  });

  it("rounds each part of a credit once, at the true product", () => {
    // Each part is its share of the converted total rounded half-even —
    // here 5260560 × 98507471701259340 / 6018312 and so on, which land on
    // whole units with nothing left over. At decimal.js's twenty digits the
    // products were rounded first, and two of the three came out a unit off.
    const allocations = [
      { participantId: "a", amount: 5_260_560n },
      { participantId: "b", amount: 846_765n },
      { participantId: "c", amount: -89_013n },
    ];
    const converted = convertAllocations(
      allocations,
      98_507_471_701_259_340n,
      6_018_312n,
    );
    expect(converted.map((entry) => entry.amount)).toEqual([
      86_104_619_589_808_045n,
      13_859_813_063_051_046n,
      -1_456_960_951_599_751n,
    ]);
  });
});
