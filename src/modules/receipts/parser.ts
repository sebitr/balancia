import { currencyExponent } from "@/modules/currencies/iso-4217";
import { findAmounts, hasDecimalPart, type AmountMatch } from "./amounts";
import { parseReceiptDate } from "./dates";
import { classifyLabel, detectCurrency } from "./labels";
import { groupLines } from "./lines";
import type {
  OcrResult,
  ParsedReceipt,
  ReceiptItem,
  ReceiptLine,
} from "./types";

/**
 * Turning recognized text into a receipt.
 *
 * This is deliberately a pile of heuristics rather than a model: heuristics can
 * be read, argued with and unit-tested against a fixture, and when one is wrong
 * the fix is a line of code rather than a retraining run. Every judgement it
 * makes is a *proposal* — the review screen exists because this will sometimes
 * be wrong, and the expense is never created from these values alone.
 *
 * The shape of a receipt that this relies on, and which holds nearly
 * everywhere:
 *
 *   - the merchant is at the top, in the first few lines, with no price;
 *   - items are lines with a price at the right-hand end;
 *   - the summary rows are labelled, and they come after the items;
 *   - the grand total is the largest labelled total.
 */

/** How far down the receipt the merchant name can still be. */
const MERCHANT_SEARCH_LINES = 6;

/** A merchant name longer than this is a slogan or an address. */
const MERCHANT_MAX_LENGTH = 60;

/** Non-price text allowed to trail an item's amount, in characters. */
const TRAILING_SLACK = 4;

interface Labelled {
  readonly line: ReceiptLine;
  readonly index: number;
  readonly amount: bigint;
}

/** The last amount on a line, which is where receipts put the one that counts. */
function trailingAmount(
  line: ReceiptLine,
  currency: string,
): AmountMatch | null {
  const amounts = findAmounts(line.text, currency);
  return amounts.at(-1) ?? null;
}

/** Whether `match` sits at the end of the line rather than inside a sentence. */
function isTrailing(line: ReceiptLine, match: AmountMatch): boolean {
  const after = line.text.slice(match.index + match.text.length);
  // A currency mark or a `*`/`A`/`B` VAT class may follow the number.
  return after.replace(/[^\p{L}\d]/gu, "").length <= TRAILING_SLACK;
}

/**
 * Whether a trailing number is a *price* rather than a table number or a count.
 *
 * Prices carry decimals in every currency that has them, which is what
 * separates `Table 5` from `Coffee 5.00` without needing to know the word
 * "table". Currencies with no minor unit are exempt, and an explicit currency
 * mark on the line settles it either way.
 */
function looksLikePrice(
  line: ReceiptLine,
  match: AmountMatch,
  currency: string,
): boolean {
  if (hasDecimalPart(match.text)) return true;
  if (currencyExponent(currency) === 0) return true;
  return detectCurrency(line.text) !== null;
}

const QUANTITY_PREFIX = /^\s*(\d{1,3})\s*(?:[x×*@]|st(?:k|ck)?\.?)\s+/i;
const QUANTITY_PREFIX_TIGHT = /^\s*(\d{1,3})[x×](?=\p{L})/iu;

/**
 * `2X/CAESAR SALAD` — a times sign followed by punctuation instead of a space.
 *
 * Straight off a real scan: the recognizer read the gap between `2X` and the
 * name as a slash. The count then stayed welded to the name and the quantity
 * stayed at one, so two salads arrived as a single line that cannot be handed
 * to two people — which is what "the items are missing" looks like from the
 * review screen.
 */
const QUANTITY_PREFIX_PUNCTUATED =
  /^\s*(\d{1,3})\s*[x×*@][/\-–.:,]+\s*(?=\p{L})/iu;
const QUANTITY_SUFFIX = /\s+[x×]\s*(\d{1,3})\s*$/i;

/**
 * A bare count in front of the name, with no `x` at all — `2 Bruschetta`,
 * which is how most Italian and French tills print a quantity.
 *
 * Two digits at most, and a letter has to follow. That keeps a year, a table
 * number or a weight (`500 g Pasta`) from being read as a count, at the price
 * of missing an order of a hundred coffees.
 */
const QUANTITY_PREFIX_BARE = /^\s*(\d{1,2})\s+(?=\p{L})/u;

/** Pulls `2 x`, `2x`, `2 @`, a bare `2 `, or a trailing `x2` off a description. */
function extractQuantity(description: string): {
  name: string;
  quantity?: number;
} {
  for (const pattern of [
    QUANTITY_PREFIX,
    QUANTITY_PREFIX_PUNCTUATED,
    QUANTITY_PREFIX_TIGHT,
    QUANTITY_PREFIX_BARE,
  ]) {
    const match = pattern.exec(description);
    if (match) {
      const quantity = Number(match[1]);
      const name = description.slice(match[0].length).trim();
      if (quantity > 0 && name !== "") return { name, quantity };
    }
  }
  const suffix = QUANTITY_SUFFIX.exec(description);
  if (suffix) {
    const quantity = Number(suffix[1]);
    const name = description.slice(0, suffix.index).trim();
    if (quantity > 0 && name !== "") return { name, quantity };
  }
  return { name: description.trim() };
}

/** Strips the price and any currency mark from the left-hand description. */
function describeItem(line: ReceiptLine, match: AmountMatch): string {
  return line.text
    .slice(0, match.index)
    .replace(/[€£$¥₺₹]\s*$/u, "")
    .replace(/\b(chf|eur|usd|gbp|sfr|fr)\.?\s*$/i, "")
    .replace(/[\s.·•*_-]+$/u, "")
    .trim();
}

/**
 * A description that is really a price column header, a VAT class letter or a
 * fragment. Two letters is the shortest plausible item name on a receipt.
 */
function isUsableDescription(description: string): boolean {
  const letters = description.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 && description.length <= 80;
}

export interface ParseOptions {
  /**
   * Currency to read amounts in when the receipt does not name one. Decides
   * how many decimal places an amount can have, so it must be the currency the
   * expense will actually be recorded in.
   */
  readonly fallbackCurrency: string;
}

/**
 * Reads a receipt out of an OCR result.
 *
 * Never throws: a photograph of a wall parses to an empty receipt, which the
 * UI reports as "nothing found" rather than as an error.
 */
export function parseReceipt(
  result: OcrResult,
  options: ParseOptions,
): ParsedReceipt {
  const lines = groupLines(result.boxes);
  if (lines.length === 0) return { items: [] };

  const wholeText = lines.map((line) => line.text).join("\n");
  const currency = detectCurrency(wholeText) ?? options.fallbackCurrency;

  /* ---------------------------------------------------------- summary rows */

  const labelled = new Map<string, Labelled[]>();
  const roles = new Array<string | null>(lines.length).fill(null);

  for (const [index, line] of lines.entries()) {
    const label = classifyLabel(line.text);
    if (label === null) continue;
    roles[index] = label;
    if (label === "noise") continue;

    const match = trailingAmount(line, currency);
    if (!match) continue;
    const bucket = labelled.get(label) ?? [];
    bucket.push({ line, index, amount: match.amount });
    labelled.set(label, bucket);
  }

  /**
   * The grand total is the largest of the total-labelled rows. A receipt that
   * prints `Total` twice (once per VAT class, once for the bill) is common;
   * the bill is never the smaller number.
   */
  const totals = labelled.get("total") ?? [];
  const totalRow = totals.reduce<Labelled | null>((best, candidate) => {
    if (!best) return candidate;
    if (candidate.amount > best.amount) return candidate;
    return best;
  }, null);

  /** For the others the last occurrence is the summary one. */
  const pick = (label: string): Labelled | null =>
    (labelled.get(label) ?? []).at(-1) ?? null;

  const subtotalRow = pick("subtotal");
  const taxRow = pick("tax");
  const tipRow = pick("tip");
  const serviceRow = pick("service");

  /* ---------------------------------------------------------------- items */

  /*
   * Where the items stop.
   *
   * This used to be the *first* summary row anywhere on the receipt, which is
   * a trap: one summary word printed above the items — `TIP IS NOT INCLUDED`,
   * `Service compris`, a VAT line above the order — moved the boundary to the
   * top of the page and silently dropped every item. Nothing looked broken;
   * the list was simply empty.
   *
   * The grand total is the reliable anchor, because it is always below the
   * items and there is only ever one of it. Rows that carry a label are
   * skipped by `roles` regardless, so the boundary's only remaining job is to
   * keep the payment lines and the barcode below the total out of the list.
   *
   * With no total read, the *last* summary row is the boundary rather than the
   * first, for the same reason: a stray label near the top must not truncate
   * the receipt.
   */
  const summaryRows = [subtotalRow, taxRow, tipRow, serviceRow].filter(
    (row): row is Labelled => row !== null,
  );
  const summaryIndex =
    totalRow?.index ??
    (summaryRows.length > 0
      ? summaryRows.reduce((latest, row) => Math.max(latest, row.index), 0)
      : lines.length);

  const items: ReceiptItem[] = [];
  for (const [index, line] of lines.entries()) {
    if (index >= summaryIndex) break;
    if (roles[index] !== null) continue;

    const match = trailingAmount(line, currency);
    if (!match) continue;
    if (!isTrailing(line, match)) continue;
    if (!looksLikePrice(line, match, currency)) continue;

    const description = describeItem(line, match);
    if (!isUsableDescription(description)) continue;

    const { name, quantity } = extractQuantity(description);
    if (!isUsableDescription(name)) continue;

    // `2 x 7.00  14.00`: the amount before the total is the unit price when it
    // multiplies out. Confirming the arithmetic is what stops a random second
    // number on the line being read as one.
    let unitPrice: bigint | undefined;
    if (quantity && quantity > 1) {
      const all = findAmounts(line.text, currency);
      const candidate = all.at(-2);
      if (candidate && candidate.amount * BigInt(quantity) === match.amount) {
        unitPrice = candidate.amount;
      }
    }

    items.push({
      id: `item-${items.length + 1}`,
      name,
      quantity,
      unitPrice,
      total: match.amount,
      confidence: line.confidence,
    });
  }

  /* -------------------------------------------------------- merchant, date */

  let merchant: string | undefined;
  for (const line of lines.slice(0, MERCHANT_SEARCH_LINES)) {
    const text = line.text.trim();
    if (text.length > MERCHANT_MAX_LENGTH) continue;
    if (classifyLabel(text) !== null) continue;
    if (findAmounts(text, currency).length > 0) continue;
    if (parseReceiptDate(text) !== null) continue;
    // An address line is not a merchant name; a street number gives it away.
    if (/\d/.test(text)) continue;
    if (text.replace(/[^\p{L}]/gu, "").length < 3) continue;
    merchant = text;
    break;
  }

  let date: string | undefined;
  for (const line of lines) {
    const parsed = parseReceiptDate(line.text);
    if (parsed) {
      date = parsed;
      break;
    }
  }

  /* ------------------------------------------------------------ confidence */

  const used = [
    ...items.map((item) => item.confidence ?? 0),
    ...(totalRow ? [totalRow.line.confidence] : []),
  ];
  const meanConfidence =
    used.length > 0
      ? used.reduce((sum, value) => sum + value, 0) / used.length
      : 0;

  // Reading nothing but a total is not a confident parse, however sharp the
  // photograph was. Completeness is part of the number the UI reacts to.
  const completeness =
    (totalRow ? 0.5 : 0) + (items.length > 0 ? 0.3 : 0) + (merchant ? 0.2 : 0);

  return {
    merchant,
    date,
    // Only report a currency the receipt actually named.
    currency: detectCurrency(wholeText) ?? undefined,
    items,
    subtotal: subtotalRow?.amount,
    tax: taxRow?.amount,
    tip: tipRow?.amount,
    service: serviceRow?.amount,
    total: totalRow?.amount,
    confidence: Number((meanConfidence * completeness).toFixed(3)),
  };
}
