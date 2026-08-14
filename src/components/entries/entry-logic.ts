import { currencyExponent } from "@/modules/currencies/iso-4217";
import type { EntryDirection } from "@/modules/expenses/direction";
import type { SplitMethod } from "@/modules/expenses/split";

/**
 * Pure logic behind the add-entry screen.
 *
 * Same contract as `expense-form-logic`: no rendering, no display text. Copy
 * comes back as a key plus params for the component to run through `t()`, so
 * this module stays locale-agnostic and the tests assert on stable keys rather
 * than on English prose.
 *
 * The split arithmetic itself is *not* here — it already exists in
 * `expense-form-logic` and `modules/expenses/split`, and the whole point of
 * this screen is that it computes the same allocations the server will.
 */

export type EntryType = "expense" | "income" | "settle";

/** A key on the amount pad. `delete` is the backspace. */
export type KeypadKey =
  "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "delete";

/** Digits before the decimal point. Past this the amount stops being credible. */
const MAX_INTEGER_DIGITS = 8;

/**
 * Applies one keypress to the raw amount text.
 *
 * The prototype caps decimals at two. This honours the currency instead: yen
 * has no minor unit and never accepts a decimal point, dinar takes three. The
 * form would otherwise let someone type ¥1200.50 and only find out it was
 * impossible when the server rejected it.
 *
 * Returns the text unchanged when a key would produce something invalid, so
 * the caller can set state unconditionally.
 */
export function pressKey(
  text: string,
  key: KeypadKey,
  currency: string,
): string {
  const exponent = currencyExponent(currency);

  if (key === "delete") return text.slice(0, -1);

  if (key === ".") {
    // A currency without a minor unit has nothing to put after the point.
    if (exponent === 0) return text;
    if (text.includes(".")) return text;
    // A leading point is how people type "point five"; make it explicit.
    return text === "" ? "0." : `${text}.`;
  }

  const [whole = "", fraction] = text.split(".");
  if (fraction === undefined) {
    // Leading zeros carry no meaning: "0" then "5" is 5, not 05.
    if (text === "0") return key;
    if (whole.length >= MAX_INTEGER_DIGITS) return text;
    return text + key;
  }
  if (fraction.length >= exponent) return text;
  return text + key;
}

/** Whether the text is a real amount greater than zero. */
export function hasAmount(text: string): boolean {
  return /\d/.test(text) && Number.parseFloat(text) > 0;
}

/**
 * The sentence under "Seb paid", as a key and params.
 *
 * Deliberately not "3 people": the useful fact about an equal split is what
 * each person carries, and that number is what someone checks before saving.
 */
export type SplitSummaryKey =
  | "equalEach"
  | "exactAmounts"
  | "percentages"
  | "shares"
  | "byItem"
  | "justOne";

export interface SplitSummary {
  readonly key: SplitSummaryKey;
  readonly params: Readonly<Record<string, string | number>>;
}

export function summariseSplit(input: {
  method: SplitMethod;
  participantCount: number;
  /** The per-person amount, already formatted, when an equal split is even. */
  eachFormatted?: string | null;
  /** True once per-item assignment has written exact values. */
  byItem?: boolean;
}): SplitSummary {
  const { method, participantCount, eachFormatted, byItem } = input;

  if (participantCount <= 1) {
    return { key: "justOne", params: { count: participantCount } };
  }
  if (byItem) {
    return { key: "byItem", params: { count: participantCount } };
  }
  switch (method) {
    case "equal":
      return {
        key: "equalEach",
        params: { count: participantCount, amount: eachFormatted ?? "" },
      };
    case "exact":
      return { key: "exactAmounts", params: { count: participantCount } };
    case "percentage":
      return { key: "percentages", params: { count: participantCount } };
    case "shares":
      return { key: "shares", params: { count: participantCount } };
  }
}

/**
 * Which way the money moved, for the screen rather than for the ledger.
 *
 * `settle` is not a direction — a repayment is neither spending nor income —
 * so it never reaches the entry writer. This exists so the amount colour, the
 * "paid"/"received" verb and the saved entry all read from one decision.
 */
export function directionOf(type: EntryType): EntryDirection | null {
  if (type === "expense") return "out";
  if (type === "income") return "in";
  return null;
}

/** The label on the primary button. */
export type PrimaryActionKey =
  | "addExpense"
  | "addIncome"
  | "saveRecurringExpense"
  | "saveRecurringIncome"
  | "recordPayment";

export function primaryActionKey(
  type: EntryType,
  repeats: boolean,
): PrimaryActionKey {
  if (type === "settle") return "recordPayment";
  if (type === "income") {
    return repeats ? "saveRecurringIncome" : "addIncome";
  }
  return repeats ? "saveRecurringExpense" : "addExpense";
}

/** The title on the confirmation screen. */
export type ConfirmationKey =
  "expenseAdded" | "incomeAdded" | "recurringSaved" | "paymentRecorded";

export function confirmationKey(
  type: EntryType,
  repeats: boolean,
): ConfirmationKey {
  if (type === "settle") return "paymentRecorded";
  if (repeats) return "recurringSaved";
  return type === "income" ? "incomeAdded" : "expenseAdded";
}

/**
 * What switching entry type has to throw away.
 *
 * Income and settlement have no receipt behind them, and a settlement is a
 * single movement that cannot recur, carry files, or be denominated in
 * anything but the group's base currency. Leaving that state behind would let
 * someone record a repayment that silently carried a scanned receipt's line
 * items — or hold on to an upload the settlement writer would quietly drop.
 */
export interface TypeSwitchReset {
  readonly clearScan: boolean;
  readonly clearRecurrence: boolean;
  readonly clearAttachments: boolean;
  readonly resetCurrency: boolean;
}

export function resetsForType(next: EntryType): TypeSwitchReset {
  return {
    clearScan: next !== "expense",
    clearRecurrence: next === "settle",
    clearAttachments: next === "settle",
    resetCurrency: next === "settle",
  };
}
