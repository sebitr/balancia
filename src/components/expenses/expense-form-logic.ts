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
  | "invalid";

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

/**
 * A per-person split value, read the one way everything that reads it does.
 *
 * The preview, the note under the rows and the payload all used to read the
 * field for themselves, and they disagreed: "33,5" was a sum the note accepted
 * and a value the preview refused, so a split could look right in the sheet
 * and be turned down on save. A comma is what a French phone offers for the
 * decimal, and "12." is somebody halfway through "12.50" who already means 12.
 *
 * Blank stays blank — what an empty field is worth depends on the method.
 */
export function readSplitValue(raw: string | undefined): string {
  const text = (raw ?? "").trim().replace(/,/g, ".");
  return text.endsWith(".") ? text.slice(0, -1) : text;
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

/**
 * The split as it would be stored, or why it would not be.
 *
 * Says nothing about rounding. Whether a moved minor unit is worth a sentence
 * depends on whether anybody can see it, which is a question about the amounts
 * side by side — `describeSplit` in `split-notes.ts` answers it.
 */
export type SplitPreview =
  | {
      ok: true;
      allocations: readonly SplitPreviewAllocation[];
      error?: undefined;
    }
  | {
      ok: false;
      /** `null` means "stay quiet" — nothing has been typed yet. */
      error: SplitMessage | null;
      allocations?: undefined;
    };

/** Domain codes that have a matching key in the catalogue, one for one. */
const ALLOCATION_MESSAGE_KEYS = {
  participantsRequired: "participantsRequired",
  valueRequired: "valueRequired",
  valueNotDecimal: "valueNotDecimal",
  valueNotInteger: "valueNotInteger",
  // Only reachable past the form, which refuses a negative exact amount and so
  // can never be handed a part larger than the total it already caps.
  valueTooLarge: "amountInvalid",
  exactSumMismatch: "exactSumMismatch",
  percentageNegative: "percentageNegative",
  percentageSumMismatch: "percentageSumMismatch",
  shareNegative: "shareNegative",
  sharesAllZero: "sharesAllZero",
  internal: "invalid",
} as const satisfies Record<AllocationErrorCode, SplitMessageKey>;

/**
 * The split's entries as `resolveSplit`, and so the server, takes them.
 *
 * One function for the preview and for the payload, so that what the sheet
 * shows and what a save sends cannot read a field two ways — they did, and a
 * cleared share was nothing to the preview and a missing value to the server.
 * An empty field is nothing: no amount on an exact split, no weight on the
 * others. A value that is not a number is passed on and refused by name.
 */
export function splitEntriesFor(input: {
  method: SplitMethod;
  participantIds: readonly string[];
  values: Readonly<Record<string, string>>;
  currency: string;
}): { participantId: string; value?: string }[] {
  const { method, participantIds, values, currency } = input;
  return participantIds.map((participantId) => {
    if (method === "equal") return { participantId };
    const text = readSplitValue(values[participantId]);
    if (method === "exact") {
      const parsed = parseAmountToMinor(text === "" ? "0" : text, currency);
      return {
        participantId,
        value: parsed.ok ? parsed.value.toString() : "",
      };
    }
    return { participantId, value: text === "" ? "0" : text };
  });
}

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

  const entries = splitEntriesFor({
    method,
    participantIds,
    values,
    currency,
  });

  try {
    const result = resolveSplit(totalMinor, { method, entries });
    const allocations = result.allocations.map((allocation) => ({
      participantId: allocation.participantId,
      amount: allocation.amount,
      formatted: formatMoney(money(allocation.amount, currency), { locale }),
    }));

    return { ok: true, allocations };
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
