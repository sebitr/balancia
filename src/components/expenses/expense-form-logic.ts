import Decimal from "decimal.js";
import {
  InvalidAmountError,
  formatMoney,
  money,
  parseMajorAmount,
  toMajorString,
} from "@/modules/currencies/money";
import { resolveSplit, type SplitMethod } from "@/modules/expenses/split";
import { AllocationError } from "@/modules/expenses/allocation";

/**
 * Pure logic behind the expense form.
 *
 * Kept out of the component so the arithmetic can be unit-tested without
 * rendering anything — and so the component stays about interaction. This is a
 * *preview*: the server recomputes the authoritative split with the same domain
 * functions when the expense is saved.
 */

export type ParseResult =
  { ok: true; value: bigint } | { ok: false; error: string };

/** Parses a user-typed major-unit amount into minor units. */
export function parseAmountToMinor(
  input: string,
  currency: string,
): ParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter an amount" };
  }
  try {
    const value = parseMajorAmount(trimmed, currency);
    if (value.amount < 0n) {
      return { ok: false, error: "The amount cannot be negative" };
    }
    return { ok: true, value: value.amount };
  } catch (error) {
    if (error instanceof InvalidAmountError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Enter a valid amount" };
  }
}

/** Renders stored minor units back into an editable major-unit string. */
export function formatMinorUnits(minorUnits: string, currency: string): string {
  try {
    return toMajorString(money(BigInt(minorUnits), currency));
  } catch {
    return "";
  }
}

export interface SplitPreviewAllocation {
  readonly participantId: string;
  readonly amount: bigint;
  readonly formatted: string;
}

export type SplitPreview =
  | {
      ok: true;
      allocations: readonly SplitPreviewAllocation[];
      /** Set when the largest-remainder pass had to move minor units around. */
      roundingNote: string | null;
      error?: undefined;
    }
  | {
      ok: false;
      error: string;
      allocations?: undefined;
      roundingNote?: undefined;
    };

/**
 * Computes the live allocation preview shown next to each participant.
 *
 * Runs the same `resolveSplit` the server uses, so what the form shows is what
 * gets stored — including which person absorbs a rounding unit.
 */
export function previewSplit(input: {
  totalMinor: bigint | null;
  currency: string;
  method: SplitMethod;
  participantIds: readonly string[];
  values: Readonly<Record<string, string>>;
}): SplitPreview {
  const { totalMinor, currency, method, participantIds, values } = input;

  if (totalMinor === null) {
    return { ok: false, error: "" };
  }
  if (participantIds.length === 0) {
    return { ok: false, error: "Choose at least one person" };
  }

  const entries = participantIds.map((participantId) => {
    if (method === "equal") {
      return { participantId };
    }
    const raw = (values[participantId] ?? "").trim();
    if (method === "exact") {
      const parsed = parseAmountToMinor(raw, currency);
      return {
        participantId,
        value: parsed.ok ? parsed.value.toString() : "",
      };
    }
    return { participantId, value: raw === "" ? "0" : raw };
  });

  try {
    const result = resolveSplit(totalMinor, { method, entries });
    const allocations = result.allocations.map((allocation) => ({
      participantId: allocation.participantId,
      amount: allocation.amount,
      formatted: formatMoney(money(allocation.amount, currency)),
    }));

    const { adjustedCount, adjustedUnits } = result.rounding;
    const roundingNote =
      adjustedUnits > 0n
        ? `This does not divide evenly. ${adjustedCount === 1 ? "One person pays" : `${adjustedCount} people pay`} ` +
          `${formatMoney(money(adjustedUnits, currency))} more so the parts add up to the total exactly.`
        : null;

    return { ok: true, allocations, roundingNote };
  } catch (error) {
    if (
      error instanceof AllocationError ||
      error instanceof InvalidAmountError
    ) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "That split is not valid" };
  }
}

/**
 * Distributes a total equally as a starting point for the exact-amount tab, so
 * switching to "Exact" pre-fills sensible values instead of blanks.
 */
export function suggestExactValues(
  totalMinor: bigint,
  currency: string,
  participantIds: readonly string[],
): Record<string, string> {
  if (participantIds.length === 0) return {};
  const split = resolveSplit(totalMinor, {
    method: "equal",
    entries: participantIds.map((participantId) => ({ participantId })),
  });
  return Object.fromEntries(
    split.allocations.map((allocation) => [
      allocation.participantId,
      toMajorString(money(allocation.amount, currency)),
    ]),
  );
}

/** Percentages that add up to exactly 100, for pre-filling the percent tab. */
export function suggestPercentages(
  participantIds: readonly string[],
): Record<string, string> {
  const count = participantIds.length;
  if (count === 0) return {};
  const base = new Decimal(100)
    .dividedBy(count)
    .toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const remainder = new Decimal(100).minus(base.times(count));
  return Object.fromEntries(
    participantIds.map((participantId, index) => [
      participantId,
      index === 0 ? base.plus(remainder).toString() : base.toString(),
    ]),
  );
}
