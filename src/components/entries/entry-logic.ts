import { currencyExponent } from "@/modules/currencies/iso-4217";
import { THRESHOLDS } from "@/modules/categorization";
import type {
  ClassificationResult,
  ExpenseCategory,
} from "@/modules/categorization";
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

/** Digits before the decimal point. Past this the amount stops being credible. */
const MAX_INTEGER_DIGITS = 8;

/**
 * Reduces whatever the keyboard produced to an amount.
 *
 * The amount field is a plain text input driven by the platform's own numeric
 * keyboard, which is not a pad under our control: it offers a comma where the
 * locale wants one, a minus and an `e` on some desktop layouts, and none of it
 * stops a paste. So rather than police keystrokes, this takes the field's
 * whole value and keeps what is still a plausible amount.
 *
 * It never rejects — an unparseable edit yields the nearest thing that parses,
 * so typing is never silently dropped mid-word and the caller can set state
 * unconditionally.
 *
 * Precision comes from the currency and not from a constant: yen has no minor
 * unit and keeps no decimal point at all, dinar keeps three. The form would
 * otherwise take ¥1200.50 and only find out it was impossible once the server
 * had refused it.
 */
export function sanitiseAmount(text: string, currency: string): string {
  const exponent = currencyExponent(currency);
  // A comma is what most of Europe gets under its thumb for the decimal.
  const cleaned = text.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");

  // Leading zeros carry no meaning: "05" is 5, while "0.5" keeps its zero.
  const digits = whole.replace(/^0+(?=\d)/, "").slice(0, MAX_INTEGER_DIGITS);

  // A currency without a minor unit has nothing to put after the point, so the
  // point goes too rather than sitting there doing nothing.
  if (exponent === 0 || !cleaned.includes(".")) return digits;

  // Everything past the first point is one fraction: "1.2.3" is 1.23. The
  // point is kept even with nothing behind it yet — that is mid-typing, not an
  // error, and eating it would make a decimal impossible to enter.
  const fraction = rest.join("").slice(0, exponent);
  return `${digits === "" ? "0" : digits}.${fraction}`;
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
  | "nobody"
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

  // An empty split is a state somebody chose, and it says so rather than
  // borrowing the one-person wording — "nobody else's balance moves" is true
  // of a split with nobody in it, and completely the wrong thing to tell them.
  if (participantCount === 0) {
    return { key: "nobody", params: {} };
  }
  if (participantCount === 1) {
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
  | "recordPayment"
  | "saveChanges";

/**
 * An edit says the same thing whatever it is editing.
 *
 * "Add expense" is worth spelling out because the button is the moment the
 * entry comes into existence and the type it comes into existence as is the
 * one fact worth confirming. Reopening one is not that moment: the entry is
 * already there, the type is already whatever the tabs say, and three verbs
 * for one act of saving would only invite a reader to look for a difference
 * between them.
 */
export function primaryActionKey(
  type: EntryType,
  repeats: boolean,
  editing = false,
): PrimaryActionKey {
  if (editing) return "saveChanges";
  if (type === "settle") return "recordPayment";
  if (type === "income") {
    return repeats ? "saveRecurringIncome" : "addIncome";
  }
  return repeats ? "saveRecurringExpense" : "addExpense";
}

/** The title on the confirmation screen. */
export type ConfirmationKey =
  | "expenseAdded"
  | "incomeAdded"
  | "recurringSaved"
  | "paymentRecorded"
  | "changesSaved";

export function confirmationKey(
  type: EntryType,
  repeats: boolean,
  editing = false,
): ConfirmationKey {
  if (editing) return "changesSaved";
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

/**
 * What the note field holds after a type switch.
 *
 * The expense tabs keep the title in `description` and the settle tab has no
 * field for one, so switching to settle used to drop whatever had been typed:
 * the reader watched the single line they had written disappear, and a
 * repayment converted from an expense arrived with nothing saying what it had
 * been for. The title moves into the note instead, which is the only place on
 * a repayment that can hold it.
 *
 * Only into an empty note. An entry that came with a note of its own — an
 * import, mostly — is carrying something the expense tabs never had room to
 * show, and a title is not worth overwriting it with.
 *
 * The move is undone on the way back, so a reader who tries the settle tab and
 * returns does not leave a copy of their title behind in the expense's notes
 * column, where nothing on this screen would show it again. A note *edited*
 * while it was over there is no longer the title, and stays.
 */
export function noteAfterTypeSwitch(input: {
  from: EntryType;
  to: EntryType;
  description: string;
  notes: string;
}): string {
  const { from, to, description, notes } = input;
  if (from === to) return notes;
  const title = description.trim();
  if (to === "settle") return notes.trim() === "" ? title : notes;
  if (from === "settle") return notes === title ? "" : notes;
  return notes;
}

/** How many chips the category picker leads with before the full list. */
export const SUGGESTED_CATEGORIES = 3;

export interface CategoryShortlist {
  readonly categories: readonly ExpenseCategory[];
  /**
   * Whether the description produced any of them — which is the difference
   * between "because it says…" and "most used", and therefore between a
   * heading that is true and one that is not.
   */
  readonly fromDescription: boolean;
}

/**
 * The few categories the picker offers before the alphabet.
 *
 * Two sources, in the order a person would think of them. What the description
 * says comes first, because they have just typed it and the answer is about
 * *this* entry. What the group usually picks fills the rest, because before
 * anything is typed there is nothing else to go on — and it beats the top of an
 * alphabetical list, which is a fact about spelling.
 *
 * Only candidates the classifier would have been willing to *offer* are taken.
 * Below that threshold its ranking is noise, and a chip is a recommendation:
 * three plausible categories help, whereas three arbitrary ones cost a reader
 * more than the full list would, because they look like they mean something.
 *
 * An already-decided answer contributes its one category and no alternatives —
 * when the classifier is that sure, the runners-up are what it rejected.
 */
export function categoryShortlist(input: {
  suggestion: ClassificationResult | null;
  frequent: readonly ExpenseCategory[];
  limit?: number;
}): CategoryShortlist {
  const { suggestion, frequent, limit = SUGGESTED_CATEGORIES } = input;

  const described: ExpenseCategory[] = [];
  if (suggestion && suggestion.category) {
    described.push(suggestion.category);
    if (suggestion.decision === "suggested") {
      for (const alternative of suggestion.alternatives) {
        if (alternative.confidence >= THRESHOLDS.suggestMinScore) {
          described.push(alternative.category);
        }
      }
    }
  }

  const ordered: ExpenseCategory[] = [];
  for (const category of [...described, ...frequent]) {
    if (ordered.length >= limit) break;
    if (!ordered.includes(category)) ordered.push(category);
  }

  return { categories: ordered, fromDescription: described.length > 0 };
}
