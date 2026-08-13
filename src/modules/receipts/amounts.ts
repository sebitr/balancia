import { currencyExponent } from "@/modules/currencies/iso-4217";

/**
 * Reading amounts off a receipt.
 *
 * `parseMajorAmount` in the currencies module is deliberately strict: it takes
 * `"10.50"` and nothing else, because it parses what a *user typed into a
 * form*. A receipt is not that. It says `12,50` in Paris, `1'234.50` in Zurich,
 * `1 234,50` in Brussels and `1,234.50` in Boston, and OCR hands all of them
 * over as text with no hint about which convention is in play.
 *
 * So this module decides the convention from the shape of the number, never
 * from a locale — a Swiss group photographing an Italian receipt would break
 * any assumption tied to the reader instead of to the paper.
 *
 * The rule, in one sentence: the **last** separator is the decimal point unless
 * it is followed by exactly three digits, in which case it is a thousands
 * separator — because `1.234` is a thousand-something everywhere that writes
 * `1.234`, and `12,50` is twelve-fifty everywhere that writes `12,50`.
 *
 * Anything that does not fit returns `null`. Guessing would put a wrong number
 * in front of someone who is about to trust it.
 */

/** Separators that are only ever grouping marks, never decimal points. */
const GROUPING_ONLY = /[\s'’   ]/g;

/** A run of digits and separators, not glued to a letter or another digit. */
const NUMERIC_RUN =
  /(?<![\p{L}\d])\d[\d '’   .,]*\d(?![\p{L}\d])|(?<![\p{L}\d])\d(?![\p{L}\d])/gu;

/** `13.08.2026`, `13/08/26`, `2026-08-13` — never an amount. */
const DATE_SHAPED = /^\d{1,4}[./-]\d{1,2}[./-]\d{2,4}$|^\d{4}-\d{2}-\d{2}$/;

/** `20:14`, `20:14:33` — never an amount. */
const TIME_SHAPED = /^\d{1,2}:\d{2}(:\d{2})?$/;

/**
 * Turns the digits and separators of one numeric run into minor units.
 *
 * `text` must already be trimmed to the run itself; surrounding currency
 * symbols and labels are the caller's business.
 */
export function parseReceiptAmount(
  text: string,
  currency: string,
): bigint | null {
  const exponent = currencyExponent(currency);

  let working = text.trim();
  if (working === "") return null;

  // European receipts print a credit as `12,50-`; accounting styles use
  // parentheses. Both are read, both keep the sign.
  let negative = false;
  if (/^\(.*\)$/.test(working)) {
    negative = true;
    working = working.slice(1, -1).trim();
  }
  if (working.startsWith("-") || working.startsWith("−")) {
    negative = true;
    working = working.slice(1).trim();
  }
  if (working.endsWith("-")) {
    negative = true;
    working = working.slice(0, -1).trim();
  }

  // Spaces and apostrophes never carry a decimal point, so they can go before
  // anything is decided. What remains is digits, '.' and ',' only.
  const cleaned = working.replace(GROUPING_ONLY, "");
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;
  if (DATE_SHAPED.test(cleaned) || TIME_SHAPED.test(working)) return null;

  const lastSeparator = Math.max(
    cleaned.lastIndexOf("."),
    cleaned.lastIndexOf(","),
  );

  let whole: string;
  let fraction: string;

  if (lastSeparator === -1) {
    whole = cleaned;
    fraction = "";
  } else {
    const tail = cleaned.slice(lastSeparator + 1);
    if (!/^\d+$/.test(tail)) return null;

    // When both marks appear, the number has told us which is which: the one
    // that comes last is the decimal point, whatever follows it. `1.234,50`
    // and `1,234.50` are the same money, and `1,234.500` in a three-digit
    // currency is 1234 dinars and 500 fils.
    const mixed = cleaned.includes(".") && cleaned.includes(",");

    // With a single kind of mark, three trailing digits are grouping —
    // `1.234` is twelve hundred and thirty-four in every country that writes
    // it — unless the currency genuinely has three minor digits.
    const decimal =
      mixed || tail.length <= 2 || (tail.length === 3 && exponent === 3);

    if (decimal) {
      whole = cleaned.slice(0, lastSeparator);
      fraction = tail;
    } else if (tail.length === 3) {
      whole = cleaned;
      fraction = "";
    } else {
      // Four or more digits after the last separator is not a grouped number
      // and not a currency this app supports. Refuse rather than invent.
      return null;
    }
  }

  // Every separator left in the integer part must be a grouping mark, and
  // grouping marks come in threes. `1.23.456` is not a number anyone printed.
  const wholeDigits = whole.replace(/[.,]/g, "");
  if (whole !== "" && !/^\d+$/.test(wholeDigits)) return null;
  if (/[.,]/.test(whole)) {
    const groups = whole.split(/[.,]/);
    if (groups[0].length < 1 || groups[0].length > 3) return null;
    if (groups.slice(1).some((group) => group.length !== 3)) return null;
  }

  if (fraction.length > exponent) {
    // More precision than the currency has. Trailing zeros are harmless noise
    // (`72.100` for a 2-digit currency); real extra digits are a misread.
    if (!/^0+$/.test(fraction.slice(exponent))) return null;
    fraction = fraction.slice(0, exponent);
  }

  const digits =
    (wholeDigits === "" ? "0" : wholeDigits) + fraction.padEnd(exponent, "0");
  if (digits === "" || !/^\d+$/.test(digits)) return null;

  const magnitude = BigInt(digits);
  return negative ? -magnitude : magnitude;
}

/** One amount found inside a line, with where it was found. */
export interface AmountMatch {
  readonly amount: bigint;
  /** Index into the original string where the run started. */
  readonly index: number;
  /** The exact text that was parsed. */
  readonly text: string;
}

/**
 * Every amount in a line, left to right.
 *
 * Receipts put the number that matters last (`2 x Bier 14.00`), so callers
 * generally want `.at(-1)` — but a quantity line carries a unit price in the
 * middle, and the item parser needs both.
 */
export function findAmounts(
  line: string,
  currency: string,
): readonly AmountMatch[] {
  const matches: AmountMatch[] = [];
  for (const match of line.matchAll(NUMERIC_RUN)) {
    const raw = match[0];
    const index = match.index ?? 0;

    // A run can end on a separator that belonged to the sentence, not the
    // number: `Total, 12.50` never happens, but `12.50,` does.
    const trimmed = raw.replace(/[.,]+$/, "");
    if (trimmed === "") continue;

    // `13.08.2026 20:14` is one run under the regex; both halves are junk.
    if (DATE_SHAPED.test(trimmed.replace(GROUPING_ONLY, ""))) continue;

    const amount = parseReceiptAmount(trimmed, currency);
    if (amount === null) continue;
    matches.push({ amount, index, text: trimmed });
  }
  return matches;
}

/**
 * Whether a run of text looks like money rather than a count, a weight or a
 * table number.
 *
 * Used to decide if the last number on a line is its price. A bare integer on
 * a receipt is usually a quantity or a product code, so an amount is trusted
 * when it has a decimal part, carries a currency mark, or is the only reading
 * that makes the line an item at all — that last judgement belongs to the
 * parser, which is why this only reports the shape.
 */
export function hasDecimalPart(text: string): boolean {
  const cleaned = text.replace(GROUPING_ONLY, "");
  const lastSeparator = Math.max(
    cleaned.lastIndexOf("."),
    cleaned.lastIndexOf(","),
  );
  if (lastSeparator === -1) return false;
  const tail = cleaned.slice(lastSeparator + 1);
  return /^\d{1,2}$/.test(tail);
}
