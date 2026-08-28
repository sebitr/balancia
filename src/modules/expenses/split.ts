import Decimal from "decimal.js";
import {
  AllocationError,
  allocateByWeights,
  describeRounding,
  validateExactAllocation,
  validatePercentages,
  validateShares,
  type RoundingReport,
} from "./allocation";

/**
 * Split methods and their normalization into final allocations.
 *
 * Every expense stores two things: the *inputs* the user chose (so the edit
 * form can restore "split by percentage, 40/35/25") and the *result* — integer
 * minor units per participant. Balances only ever read the result, which keeps
 * the balance engine independent of how a split was expressed.
 */

export const SPLIT_METHODS = [
  "equal",
  "exact",
  "percentage",
  "shares",
] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

/** One participant's contribution to the split input, before normalization. */
export interface SplitInputEntry {
  readonly participantId: string;
  /**
   * Method-dependent input:
   *  - equal:      ignored (participation is membership in the list)
   *  - exact:      minor units for this participant
   *  - percentage: percentage points as a decimal string, e.g. "33.33"
   *  - shares:     weight as a decimal string, e.g. "2"
   */
  readonly value?: string;
}

export interface SplitInput {
  readonly method: SplitMethod;
  readonly entries: readonly SplitInputEntry[];
}

export interface AllocationEntry {
  readonly participantId: string;
  /** Final allocation in integer minor units. */
  readonly amount: bigint;
}

/**
 * Pairs each participant with the amount allocated to them.
 *
 * `allocateByWeights` returns one amount per weight, and the weights are built
 * from these same rows, so the two are the same length by construction. The
 * compiler cannot see that; nor could a future caller that got it wrong. So
 * the pairing is stated once here rather than trusting a bare index at seven
 * call sites.
 */
function pairWithAmounts(
  rows: readonly { participantId: string }[],
  amounts: readonly bigint[],
): AllocationEntry[] {
  if (amounts.length !== rows.length) {
    throw new AllocationError(
      `Allocation produced ${amounts.length} parts for ${rows.length} participants`,
    );
  }
  return rows.map((row, index) => {
    const amount = amounts[index];
    if (amount === undefined) {
      throw new AllocationError("Allocation is missing a part");
    }
    return { participantId: row.participantId, amount };
  });
}

export interface SplitResult {
  readonly method: SplitMethod;
  readonly allocations: readonly AllocationEntry[];
  readonly rounding: RoundingReport;
}

function assertUniqueParticipants(entries: readonly SplitInputEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.participantId)) {
      throw new AllocationError(
        `Participant ${entry.participantId} appears more than once in the split`,
      );
    }
    seen.add(entry.participantId);
  }
}

function parseDecimal(value: string | undefined, label: string): Decimal {
  if (value === undefined || value.trim() === "") {
    throw new AllocationError(
      `${label} is required for this split method`,
      "valueRequired",
    );
  }
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new AllocationError(
      `${label} must be a non-negative decimal number`,
      "valueNotDecimal",
    );
  }
  return new Decimal(trimmed);
}

function parseMinorUnits(value: string | undefined, label: string): bigint {
  if (value === undefined || value.trim() === "") {
    throw new AllocationError(
      `${label} is required for this split method`,
      "valueRequired",
    );
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new AllocationError(
      `${label} must be an integer number of minor units`,
      "valueNotInteger",
    );
  }
  return BigInt(trimmed);
}

/**
 * Normalizes any split method into final per-participant allocations that sum
 * exactly to `total`.
 *
 * `total` is in the currency the expense is *recorded* in. Conversion to a
 * group's base currency happens after normalization, on the total and each
 * allocation, so converted amounts also sum exactly (see `convertAllocations`).
 */
export function resolveSplit(total: bigint, input: SplitInput): SplitResult {
  const { method, entries } = input;
  if (entries.length === 0) {
    throw new AllocationError(
      "An expense must be split between at least one participant",
      "participantsRequired",
    );
  }
  assertUniqueParticipants(entries);

  switch (method) {
    case "equal": {
      const weights = entries.map(() => new Decimal(1));
      const amounts = allocateByWeights(total, weights);
      return {
        method,
        allocations: pairWithAmounts(entries, amounts),
        rounding: describeRounding(total, weights, amounts),
      };
    }

    case "exact": {
      const amounts = entries.map((entry, index) =>
        parseMinorUnits(entry.value, `Amount for participant ${index + 1}`),
      );
      validateExactAllocation(total, amounts);
      return {
        method,
        allocations: pairWithAmounts(entries, amounts),
        // Exact splits are supplied whole; nothing is redistributed.
        rounding: { adjustedCount: 0, adjustedUnits: 0n },
      };
    }

    case "percentage": {
      const percentages = entries.map((entry, index) =>
        parseDecimal(entry.value, `Percentage for participant ${index + 1}`),
      );
      validatePercentages(percentages);
      const amounts = allocateByWeights(total, percentages);
      return {
        method,
        allocations: pairWithAmounts(entries, amounts),
        rounding: describeRounding(total, percentages, amounts),
      };
    }

    case "shares": {
      const shares = entries.map((entry, index) =>
        parseDecimal(entry.value, `Share for participant ${index + 1}`),
      );
      validateShares(shares);
      const amounts = allocateByWeights(total, shares);
      return {
        method,
        allocations: pairWithAmounts(entries, amounts),
        rounding: describeRounding(total, shares, amounts),
      };
    }

    default: {
      const exhaustive: never = method;
      throw new AllocationError(
        `Unsupported split method: ${String(exhaustive)}`,
      );
    }
  }
}

/**
 * Validates payer contributions: an expense can be paid by several people, and
 * what they paid together must equal the expense total.
 */
export function validatePayerContributions(
  total: bigint,
  contributions: readonly { participantId: string; amount: bigint }[],
): void {
  if (contributions.length === 0) {
    throw new AllocationError("An expense needs at least one payer");
  }
  const seen = new Set<string>();
  for (const contribution of contributions) {
    if (seen.has(contribution.participantId)) {
      throw new AllocationError(
        `Payer ${contribution.participantId} appears more than once`,
      );
    }
    seen.add(contribution.participantId);
    if (contribution.amount < 0n) {
      throw new AllocationError("Payer contributions must not be negative");
    }
  }
  const sum = contributions.reduce(
    (accumulator, contribution) => accumulator + contribution.amount,
    0n,
  );
  if (sum !== total) {
    throw new AllocationError(
      `Payer contributions must sum to the expense total. Expected ${total}, received ${sum}.`,
    );
  }
}

/**
 * Converts a set of allocations that sum to `total` into a target currency such
 * that the converted parts still sum exactly to the converted total.
 *
 * Converting each part independently would drift by a unit or two, so the total
 * is converted first (that is the number the group's balances must honour) and
 * the parts are then re-allocated proportionally to their original amounts.
 */
export function convertAllocations(
  allocations: readonly AllocationEntry[],
  convertedTotal: bigint,
  originalTotal: bigint,
): AllocationEntry[] {
  if (originalTotal === 0n) {
    if (convertedTotal !== 0n) {
      throw new AllocationError(
        "Cannot distribute a non-zero converted total across a zero-value expense",
      );
    }
    return allocations.map((allocation) => ({
      participantId: allocation.participantId,
      amount: 0n,
    }));
  }
  const weights = allocations.map(
    (allocation) => new Decimal(allocation.amount.toString()),
  );
  const negativeWeights = weights.some((weight) => weight.isNegative());
  if (negativeWeights) {
    // Mixed-sign allocations (a credit inside an expense) cannot be expressed
    // as proportional weights; convert each part and absorb the residue on the
    // largest part so the sum still matches.
    return distributeResidue(allocations, convertedTotal, originalTotal);
  }
  const amounts = allocateByWeights(convertedTotal, weights);
  return pairWithAmounts(allocations, amounts);
}

function distributeResidue(
  allocations: readonly AllocationEntry[],
  convertedTotal: bigint,
  originalTotal: bigint,
): AllocationEntry[] {
  const ratio = new Decimal(convertedTotal.toString()).dividedBy(
    new Decimal(originalTotal.toString()),
  );
  const scaled = allocations.map((allocation) => {
    const value = new Decimal(allocation.amount.toString())
      .times(ratio)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
    return BigInt(value.toFixed(0));
  });
  const sum = scaled.reduce((accumulator, value) => accumulator + value, 0n);
  let residue = convertedTotal - sum;
  if (residue !== 0n) {
    // Absorb on the largest-magnitude allocation; deterministic by index tie-break.
    let targetIndex = 0;
    let best = -1n;
    for (const [index, value] of scaled.entries()) {
      const magnitude = value < 0n ? -value : value;
      if (magnitude > best) {
        best = magnitude;
        targetIndex = index;
      }
    }
    const target = scaled[targetIndex];
    if (target === undefined) {
      throw new AllocationError("Allocation has no part to absorb the residue");
    }
    scaled[targetIndex] = target + residue;
    residue = 0n;
  }
  return pairWithAmounts(allocations, scaled);
}
