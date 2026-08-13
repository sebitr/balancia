import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import fc from "fast-check";
import {
  AllocationError,
  allocateByWeights,
  allocateEqually,
  describeRounding,
  validateExactAllocation,
  validatePercentages,
  validateShares,
} from "./allocation";

const sum = (values: readonly bigint[]): bigint =>
  values.reduce((accumulator, value) => accumulator + value, 0n);

describe("allocateEqually", () => {
  it("splits an evenly divisible total", () => {
    expect(allocateEqually(1000n, 4)).toEqual([250n, 250n, 250n, 250n]);
  });

  it("gives the leftover minor units to the earliest participants", () => {
    // 10.00 EUR between 3 people: 3.34 / 3.33 / 3.33
    expect(allocateEqually(1000n, 3)).toEqual([334n, 333n, 333n]);
    // 0.01 EUR between 3 people: someone gets the cent, nobody gets a fraction
    expect(allocateEqually(1n, 3)).toEqual([1n, 0n, 0n]);
    // 0.05 between 3: 2 / 2 / 1
    expect(allocateEqually(5n, 3)).toEqual([2n, 2n, 1n]);
  });

  it("handles indivisible totals for zero-decimal currencies", () => {
    // 100 JPY between 3 people
    expect(allocateEqually(100n, 3)).toEqual([34n, 33n, 33n]);
  });

  it("handles negative totals (refunds) symmetrically", () => {
    expect(allocateEqually(-1000n, 3)).toEqual([-334n, -333n, -333n]);
    expect(sum(allocateEqually(-1000n, 3))).toBe(-1000n);
  });

  it("returns an empty allocation for zero participants and zero total", () => {
    expect(allocateEqually(0n, 0)).toEqual([]);
  });

  it("refuses to allocate a non-zero total to nobody", () => {
    expect(() => allocateEqually(100n, 0)).toThrow(AllocationError);
  });
});

describe("allocateByWeights", () => {
  it("allocates proportionally to shares", () => {
    // 2:1:1 of 100.00
    const result = allocateByWeights(10000n, [
      new Decimal(2),
      new Decimal(1),
      new Decimal(1),
    ]);
    expect(result).toEqual([5000n, 2500n, 2500n]);
  });

  it("allocates weighted shares that do not divide evenly", () => {
    // 1:1:1 of 100 minor units -> 34/33/33
    expect(
      allocateByWeights(100n, [new Decimal(1), new Decimal(1), new Decimal(1)]),
    ).toEqual([34n, 33n, 33n]);
    // 3:1 of 10 -> 7.5/2.5 -> largest remainder gives the odd unit to index 0 or 1
    const result = allocateByWeights(10n, [new Decimal(3), new Decimal(1)]);
    expect(sum(result)).toBe(10n);
    expect(result).toEqual([8n, 2n]);
  });

  it("supports fractional weights", () => {
    const result = allocateByWeights(10000n, [
      new Decimal("1.5"),
      new Decimal("0.5"),
    ]);
    expect(result).toEqual([7500n, 2500n]);
  });

  it("allows a zero weight to receive nothing", () => {
    expect(
      allocateByWeights(1000n, [
        new Decimal(1),
        new Decimal(0),
        new Decimal(1),
      ]),
    ).toEqual([500n, 0n, 500n]);
  });

  it("rejects negative weights and all-zero weights", () => {
    expect(() =>
      allocateByWeights(100n, [new Decimal(-1), new Decimal(2)]),
    ).toThrow(AllocationError);
    expect(() =>
      allocateByWeights(100n, [new Decimal(0), new Decimal(0)]),
    ).toThrow(AllocationError);
  });

  it("is deterministic across repeated calls", () => {
    const weights = [new Decimal(1), new Decimal(1), new Decimal(1)];
    const first = allocateByWeights(1000n, weights);
    const second = allocateByWeights(1000n, weights);
    expect(first).toEqual(second);
  });
});

describe("allocation invariants (property-based)", () => {
  const weightArbitrary = fc
    .integer({ min: 0, max: 10_000 })
    .map((value) => new Decimal(value).dividedBy(100));

  it("always sums exactly to the total", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc
          .array(weightArbitrary, { minLength: 1, maxLength: 25 })
          .filter((weights) => weights.some((weight) => weight.greaterThan(0))),
        (total, weights) => {
          const allocation = allocateByWeights(total, weights);
          expect(sum(allocation)).toBe(total);
          expect(allocation).toHaveLength(weights.length);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("never distributes more than one extra minor unit per participant", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc
          .array(fc.integer({ min: 1, max: 50 }), {
            minLength: 1,
            maxLength: 20,
          })
          .map((values) => values.map((value) => new Decimal(value))),
        (total, weights) => {
          const allocation = allocateByWeights(total, weights);
          const weightSum = weights.reduce(
            (accumulator, weight) => accumulator.plus(weight),
            new Decimal(0),
          );
          for (const [index, weight] of weights.entries()) {
            const exact = new Decimal(total.toString())
              .times(weight)
              .dividedBy(weightSum);
            const floor = BigInt(exact.floor().toFixed(0));
            const received = allocation[index];
            expect(received === floor || received === floor + 1n).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("gives equal weights near-equal amounts", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.integer({ min: 1, max: 30 }),
        (total, count) => {
          const allocation = allocateEqually(total, count);
          const min = allocation.reduce((a, b) => (a < b ? a : b));
          const max = allocation.reduce((a, b) => (a > b ? a : b));
          expect(max - min <= 1n).toBe(true);
          expect(sum(allocation)).toBe(total);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("allocates the same way regardless of how many times it runs", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc
          .array(fc.integer({ min: 0, max: 100 }), {
            minLength: 1,
            maxLength: 12,
          })
          .filter((values) => values.some((value) => value > 0))
          .map((values) => values.map((value) => new Decimal(value))),
        (total, weights) => {
          expect(allocateByWeights(total, weights)).toEqual(
            allocateByWeights(total, weights),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("describeRounding", () => {
  it("reports no adjustment for an even split", () => {
    const weights = [new Decimal(1), new Decimal(1)];
    const allocation = allocateByWeights(1000n, weights);
    expect(describeRounding(1000n, weights, allocation)).toEqual({
      adjustedCount: 0,
      adjustedUnits: 0n,
    });
  });

  it("reports the participants who absorbed a rounding unit", () => {
    const weights = [new Decimal(1), new Decimal(1), new Decimal(1)];
    const allocation = allocateByWeights(1000n, weights);
    expect(describeRounding(1000n, weights, allocation)).toEqual({
      adjustedCount: 1,
      adjustedUnits: 1n,
    });
  });
});

describe("validateExactAllocation", () => {
  it("accepts amounts that sum to the total", () => {
    expect(() => validateExactAllocation(1000n, [400n, 600n])).not.toThrow();
  });

  it("rejects amounts that miss the total by a single minor unit", () => {
    expect(() => validateExactAllocation(1000n, [400n, 599n])).toThrow(
      AllocationError,
    );
    expect(() => validateExactAllocation(1000n, [400n, 601n])).toThrow(
      AllocationError,
    );
  });
});

describe("validatePercentages", () => {
  it("accepts percentages summing to exactly 100", () => {
    expect(() =>
      validatePercentages([
        new Decimal("33.33"),
        new Decimal("33.33"),
        new Decimal("33.34"),
      ]),
    ).not.toThrow();
  });

  it("rejects sums that are off by a hundredth", () => {
    expect(() =>
      validatePercentages([
        new Decimal("33.33"),
        new Decimal("33.33"),
        new Decimal("33.33"),
      ]),
    ).toThrow(AllocationError);
  });

  it("rejects negative percentages", () => {
    expect(() =>
      validatePercentages([new Decimal("110"), new Decimal("-10")]),
    ).toThrow(AllocationError);
  });

  it("accepts fractional percentages that floats would fumble", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; decimal arithmetic gets it right
    const parts = [new Decimal("0.1"), new Decimal("0.2"), new Decimal("99.7")];
    expect(() => validatePercentages(parts)).not.toThrow();
  });
});

describe("validateShares", () => {
  it("accepts positive shares", () => {
    expect(() =>
      validateShares([new Decimal(2), new Decimal(1), new Decimal(0)]),
    ).not.toThrow();
  });

  it("rejects all-zero and negative shares", () => {
    expect(() => validateShares([new Decimal(0), new Decimal(0)])).toThrow(
      AllocationError,
    );
    expect(() => validateShares([new Decimal(-1), new Decimal(3)])).toThrow(
      AllocationError,
    );
  });
});
