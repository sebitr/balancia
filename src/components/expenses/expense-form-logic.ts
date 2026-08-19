import Decimal from "decimal.js";
import {
  InvalidAmountError,
  formatMoney,
  money,
  parseMajorAmount,
  toMajorString,
} from "@/modules/currencies/money";
import { resolveSplit, type SplitMethod } from "@/modules/expenses/split";
import {
  AllocationError,
  type AllocationErrorCode,
} from "@/modules/expenses/allocation";

/**
 * Pure logic behind the expense form.
 *
 * Kept out of the component so the arithmetic can be unit-tested without
 * rendering anything — and so the component stays about interaction. This is a
 * *preview*: the server recomputes the authoritative split with the same domain
 * functions when the expense is saved.
 *
 * Nothing here returns display text. Failures come back as a `SplitMessage`
 * naming a key in the `expenses.split` catalogue, which the component renders
 * through `t()`. That keeps this module locale-agnostic and lets the tests
 * assert on stable keys rather than on English prose.
 */

/** Keys under the `expenses.split` namespace this module can produce. */
export type SplitMessageKey =
  | "amountRequired"
  | "amountNegative"
  | "amountNotDecimal"
  | "amountTooPrecise"
  | "amountInvalid"
  | "participantsRequired"
  | "valueRequired"
  | "valueNotDecimal"
  | "valueNotInteger"
  | "exactSumMismatch"
  | "percentageNegative"
  | "percentageSumMismatch"
  | "shareNegative"
  | "sharesAllZero"
  | "invalid"
  | "roundingNote";

export interface SplitMessage {
  readonly key: SplitMessageKey;
  readonly params?: Readonly<Record<string, string | number>>;
}

export type ParseResult =
  { ok: true; value: bigint } | { ok: false; error: SplitMessage };

/** Maps a thrown domain error onto a catalogue key, if it carries one. */
function messageForAmountError(error: InvalidAmountError): SplitMessage {
  switch (error.code) {
    case "notDecimal":
      return { key: "amountNotDecimal" };
    case "tooPrecise":
      return { key: "amountTooPrecise", params: error.params };
    default:
      return { key: "amountInvalid" };
  }
}

/** Parses a user-typed major-unit amount into minor units. */
export function parseAmountToMinor(
  input: string,
  currency: string,
): ParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: { key: "amountRequired" } };
  }
  try {
    const value = parseMajorAmount(trimmed, currency);
    if (value.amount < 0n) {
      return { ok: false, error: { key: "amountNegative" } };
    }
    return { ok: true, value: value.amount };
  } catch (error) {
    if (error instanceof InvalidAmountError) {
      return { ok: false, error: messageForAmountError(error) };
    }
    return { ok: false, error: { key: "amountInvalid" } };
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

/**
 * The inverse of what the form submits: stored split values, back into the
 * text their fields hold.
 *
 * Only exact splits need turning: they are stored in minor units, while shares
 * and percentages are stored as the decimal strings that were typed and an
 * equal split stores no values at all. Reopening 83333 as an exact amount
 * would read as 83 333, a hundred times the 833.33 that was entered.
 */
export function splitValuesToText(
  method: SplitMethod,
  entries: readonly { participantId: string; value?: string }[],
  currency: string,
): Record<string, string> {
  return Object.fromEntries(
    entries.flatMap((entry) =>
      entry.value === undefined
        ? []
        : [
            [
              entry.participantId,
              method === "exact"
                ? formatMinorUnits(entry.value, currency)
                : entry.value,
            ],
          ],
    ),
  );
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
      roundingNote: SplitMessage | null;
      error?: undefined;
    }
  | {
      ok: false;
      /** `null` means "stay quiet" — nothing has been typed yet. */
      error: SplitMessage | null;
      allocations?: undefined;
      roundingNote?: undefined;
    };

/** Domain codes that have a matching key in the catalogue, one for one. */
const ALLOCATION_MESSAGE_KEYS = {
  participantsRequired: "participantsRequired",
  valueRequired: "valueRequired",
  valueNotDecimal: "valueNotDecimal",
  valueNotInteger: "valueNotInteger",
  exactSumMismatch: "exactSumMismatch",
  percentageNegative: "percentageNegative",
  percentageSumMismatch: "percentageSumMismatch",
  shareNegative: "shareNegative",
  sharesAllZero: "sharesAllZero",
  internal: "invalid",
} as const satisfies Record<AllocationErrorCode, SplitMessageKey>;

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
  /** Formats the preview amounts; defaults to the runtime's locale. */
  locale?: string;
}): SplitPreview {
  const { totalMinor, currency, method, participantIds, values, locale } =
    input;

  if (totalMinor === null) {
    return { ok: false, error: null };
  }
  if (participantIds.length === 0) {
    return { ok: false, error: { key: "participantsRequired" } };
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
      formatted: formatMoney(money(allocation.amount, currency), { locale }),
    }));

    const { adjustedCount, adjustedUnits } = result.rounding;
    const roundingNote: SplitMessage | null =
      adjustedUnits > 0n
        ? {
            key: "roundingNote",
            params: {
              count: adjustedCount,
              amount: formatMoney(money(adjustedUnits, currency), { locale }),
            },
          }
        : null;

    return { ok: true, allocations, roundingNote };
  } catch (error) {
    if (error instanceof AllocationError) {
      return {
        ok: false,
        error: {
          key: ALLOCATION_MESSAGE_KEYS[error.code],
          params: error.params,
        },
      };
    }
    if (error instanceof InvalidAmountError) {
      return { ok: false, error: messageForAmountError(error) };
    }
    return { ok: false, error: { key: "invalid" } };
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
