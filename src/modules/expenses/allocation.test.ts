import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import fc from "fast-check";
import { MAX_MINOR_UNITS } from "@/modules/currencies/money";
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

/**
 * Largest remainder worked in whole numbers, with nothing to round: what
 * `allocateByWeights` has to return for weights already scaled to integers.
 *
 * The reference the bound tests below hold the real thing to. While the real
 * thing was worked in decimal.js the two parted company: at its default twenty
 * digits as soon as a total and a weight had more digits between them than
 * that, well inside the amounts the schema accepts; and at any precision on a
 * tie between shares of different lengths. Either way a rounding unit went to
 * a part it was not owed to.
 */
function exactAllocation(total: bigint, weights: readonly bigint[]): bigint[] {
  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const weightSum = sum(weights);
  const floors = weights.map((weight) => (magnitude * weight) / weightSum);
  const ranked = weights
    .map((weight, index) => ({
      index,
      remainder: (magnitude * weight) % weightSum,
    }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  let leftover = magnitude - sum(floors);
  for (let cursor = 0; leftover > 0n; cursor += 1) {
    const target = ranked[cursor % ranked.length]!;
    floors[target.index] = floors[target.index]! + 1n;
    leftover -= 1n;
  }
  return negative ? floors.map((value) => -value) : floors;
}

describe("allocation at the accepted bounds (property-based)", () => {
  it("matches whole-number arithmetic when the weights are amounts", () => {
    // What `convertAllocations` does: a converted total spread in proportion
    // to the parts it came from, every one of them up to the largest amount.
    fc.assert(
      fc.property(
        fc.bigInt({ min: -MAX_MINOR_UNITS, max: MAX_MINOR_UNITS }),
        fc
          .array(fc.bigInt({ min: 0n, max: MAX_MINOR_UNITS }), {
            minLength: 1,
            maxLength: 12,
          })
          .filter((weights) => weights.some((weight) => weight > 0n)),
        (total, weights) => {
          const allocation = allocateByWeights(
            total,
            weights.map((weight) => new Decimal(weight.toString())),
          );
          expect(allocation).toEqual(exactAllocation(total, weights));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("matches whole-number arithmetic for percentages of the largest totals", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: MAX_MINOR_UNITS / 1000n, max: MAX_MINOR_UNITS }),
        // Hundredths of a percent, as the percentage tab writes them.
        fc
          .array(fc.integer({ min: 0, max: 10_000 }), {
            minLength: 1,
            maxLength: 12,
          })
          .filter((hundredths) => hundredths.some((value) => value > 0)),
        (total, hundredths) => {
          const allocation = allocateByWeights(
            total,
            hundredths.map((value) => new Decimal(value).dividedBy(100)),
          );
          expect(allocation).toEqual(
            exactAllocation(
              total,
              hundredths.map((value) => BigInt(value)),
            ),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it("gives the rounding unit to the part that is owed it", () => {
    // Found by the property above at twenty digits, kept as a fixed case
    // because a random search only finds one in a few hundred: the products
    // were rounded before the division, the remainders came out in the wrong
    // order, and the last unit went to the fifth part instead of the first.
    const total = 294804489140145177n;
    const weights = [
      561218906782960356n,
      226580797222396110n,
      52237994555873719n,
      419167984607593237n,
      211793515430789085n,
    ];
    expect(
      allocateByWeights(
        total,
        weights.map((weight) => new Decimal(weight.toString())),
      ),
    ).toEqual([
      112474468556780469n,
      45409294741768669n,
      10469071168366912n,
      84005894553706464n,
      42445760119522663n,
    ]);
  });

  it("settles a tie by the caller's order, whatever the size of the shares", () => {
    // 4 over 10:1:1 leaves every part a third of a unit over its floor. Worked
    // in decimals, the third after 3 was cut one digit shorter than the thirds
    // after 0, came out smaller, and the unit went to the second person.
    expect(
      allocateByWeights(4n, [new Decimal(10), new Decimal(1), new Decimal(1)]),
    ).toEqual([4n, 0n, 0n]);

    // The same thing at the scale the percentage property works at, where it
    // turned up about once in twenty-five thousand runs: parts three and five
    // are owed the same fraction, and the third comes first.
    expect(
      allocateByWeights(
        688733842980964935n,
        [1794, 2837, 5351, 9925, 1569, 1614, 4935, 7005].map((hundredths) =>
          new Decimal(hundredths).dividedBy(100),
        ),
      ),
    ).toEqual([
      35272295584009452n,
      55778986940822082n,
      105207387775939006n,
      195137978635057864n,
      30848512693038366n,
      31733269271232584n,
      97028304741965799n,
      137727107338899782n,
    ]);
  });
});

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
        // The whole range an amount may have, not a comfortable corner of it.
        fc.bigInt({ min: -MAX_MINOR_UNITS, max: MAX_MINOR_UNITS }),
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
