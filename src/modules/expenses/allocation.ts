import Decimal from "decimal.js";

/**
 * Deterministic money allocation.
 *
 * Splitting a total into weighted parts almost never divides evenly, so some
 * parts must absorb an extra minor unit. Balancia uses the *largest remainder*
 * method: floor every part, then hand the leftover units to the parts with the
 * biggest fractional remainders, breaking ties by the caller's ordering. This
 * guarantees two properties every test in this module asserts:
 *
 *   1. Σ(parts) === total, exactly, always.
 *   2. The same inputs in the same order always produce the same output.
 *
 * The ordering is the participant order supplied by the caller, which the
 * services derive from a stable database ordering (participant id), so an
 * expense re-rendered tomorrow splits its rounding pennies the same way.
 */

/**
 * Machine-readable reasons a split can be rejected.
 *
 * The `message` on an `AllocationError` stays English and developer-facing;
 * `code` is what the UI translates. Everything a user can actually trigger by
 * typing into the expense form has its own code — `internal` covers the
 * defensive invariants, which are bugs rather than input problems.
 */
export type AllocationErrorCode =
  | "internal"
  | "participantsRequired"
  | "valueRequired"
  | "valueNotDecimal"
  | "valueNotInteger"
  | "exactSumMismatch"
  | "percentageNegative"
  | "percentageSumMismatch"
  | "shareNegative"
  | "sharesAllZero";

export class AllocationError extends Error {
  readonly code: AllocationErrorCode;
  /** Values the translated message interpolates, e.g. the received total. */
  readonly params: Readonly<Record<string, string | number>>;

  constructor(
    message: string,
    code: AllocationErrorCode = "internal",
    params: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "AllocationError";
    this.code = code;
    this.params = params;
  }
}

/**
 * Allocates `total` minor units across `weights` proportionally.
 *
 * Weights are non-negative decimals (shares, percentages, or all-ones for an
 * equal split). Negative totals are supported (refunds/credits): the algorithm
 * allocates the magnitude and flips the signs back, so the invariant holds in
 * both directions.
 */
export function allocateByWeights(
  total: bigint,
  weights: readonly Decimal[],
): bigint[] {
  if (weights.length === 0) {
    if (total !== 0n) {
      throw new AllocationError(
        "Cannot allocate a non-zero total across zero participants",
      );
    }
    return [];
  }

  for (const weight of weights) {
    if (weight.isNegative()) {
      throw new AllocationError("Allocation weights must not be negative");
    }
    if (!weight.isFinite()) {
      throw new AllocationError("Allocation weights must be finite");
    }
  }

  const weightSum = weights.reduce(
    (sum, weight) => sum.plus(weight),
    new Decimal(0),
  );
  if (weightSum.isZero()) {
    throw new AllocationError(
      "Allocation weights must not all be zero — nothing would receive the total",
    );
  }

  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const decimalTotal = new Decimal(magnitude.toString());

  // Floor each exact share; track the fractional remainder for the second pass.
  const floors: bigint[] = [];
  const remainders: { index: number; remainder: Decimal }[] = [];
  let allocated = 0n;

  for (const [index, weight] of weights.entries()) {
    const exact = decimalTotal.times(weight).dividedBy(weightSum);
    const floor = exact.floor();
    const floorBig = BigInt(floor.toFixed(0));
    floors.push(floorBig);
    allocated += floorBig;
    remainders.push({ index, remainder: exact.minus(floor) });
  }

  let leftover = magnitude - allocated;
  if (leftover < 0n) {
    // Defensive: flooring can never over-allocate.
    throw new AllocationError("Allocation over-distributed the total");
  }

  // Largest remainder first; ties resolved by original index for determinism.
  const ranked = [...remainders].sort((a, b) => {
    const comparison = b.remainder.comparedTo(a.remainder);
    return comparison !== 0 ? comparison : a.index - b.index;
  });

  let cursor = 0;
  while (leftover > 0n) {
    const target = ranked[cursor % ranked.length];
    floors[target.index] += 1n;
    leftover -= 1n;
    cursor += 1;
  }

  return negative ? floors.map((value) => -value) : floors;
}

/** Equal split: every participant carries the same weight. */
export function allocateEqually(total: bigint, count: number): bigint[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new AllocationError(
      `Participant count must be a non-negative integer, got ${count}`,
    );
  }
  return allocateByWeights(
    total,
    Array.from({ length: count }, () => new Decimal(1)),
  );
}

/**
 * Describes how far an allocation had to bend to fit whole minor units. The UI
 * surfaces this so a one-cent difference is visible rather than mysterious.
 */
export interface RoundingReport {
  /** Number of participants who received one extra minor unit. */
  readonly adjustedCount: number;
  /** Total minor units redistributed by the largest-remainder pass. */
  readonly adjustedUnits: bigint;
}

export function describeRounding(
  total: bigint,
  weights: readonly Decimal[],
  allocation: readonly bigint[],
): RoundingReport {
  if (weights.length !== allocation.length) {
    throw new AllocationError(
      "Weights and allocation must have the same length",
    );
  }
  const weightSum = weights.reduce(
    (sum, weight) => sum.plus(weight),
    new Decimal(0),
  );
  if (weightSum.isZero()) {
    return { adjustedCount: 0, adjustedUnits: 0n };
  }
  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const decimalTotal = new Decimal(magnitude.toString());

  let adjustedCount = 0;
  let adjustedUnits = 0n;
  for (const [index, weight] of weights.entries()) {
    const exact = decimalTotal.times(weight).dividedBy(weightSum);
    const floorBig = BigInt(exact.floor().toFixed(0));
    const actual = negative ? -allocation[index] : allocation[index];
    const difference = actual - floorBig;
    if (difference !== 0n) {
      adjustedCount += 1;
      adjustedUnits += difference > 0n ? difference : -difference;
    }
  }
  return { adjustedCount, adjustedUnits };
}

/**
 * Validates exact-amount splits: the parts are given directly and must add up
 * to the expense total, to the minor unit.
 */
export function validateExactAllocation(
  total: bigint,
  parts: readonly bigint[],
): void {
  const sum = parts.reduce((accumulator, part) => accumulator + part, 0n);
  if (sum !== total) {
    throw new AllocationError(
      `Exact amounts must sum to the expense total. Expected ${total}, received ${sum}.`,
      "exactSumMismatch",
      { expected: total.toString(), received: sum.toString() },
    );
  }
}

/**
 * Validates percentage splits against exactly 100%, using decimal arithmetic
 * so 33.33 + 33.33 + 33.34 is accepted where floats would drift.
 */
export function validatePercentages(percentages: readonly Decimal[]): void {
  if (percentages.length === 0) {
    throw new AllocationError("A percentage split needs at least one share");
  }
  for (const percentage of percentages) {
    if (percentage.isNegative()) {
      throw new AllocationError(
        "Percentages must not be negative",
        "percentageNegative",
      );
    }
  }
  const sum = percentages.reduce(
    (accumulator, percentage) => accumulator.plus(percentage),
    new Decimal(0),
  );
  if (!sum.equals(100)) {
    throw new AllocationError(
      `Percentages must sum to exactly 100, received ${sum.toString()}`,
      "percentageSumMismatch",
      { received: sum.toString() },
    );
  }
}

export function validateShares(shares: readonly Decimal[]): void {
  if (shares.length === 0) {
    throw new AllocationError("A share split needs at least one participant");
  }
  for (const share of shares) {
    if (share.isNegative()) {
      throw new AllocationError("Shares must not be negative", "shareNegative");
    }
  }
  const sum = shares.reduce(
    (accumulator, share) => accumulator.plus(share),
    new Decimal(0),
  );
  if (sum.isZero()) {
    throw new AllocationError(
      "At least one share must be greater than zero",
      "sharesAllZero",
    );
  }
}
