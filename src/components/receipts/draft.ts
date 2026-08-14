import {
  formatMinorUnits,
  parseAmountToMinor,
} from "@/components/expenses/expense-form-logic";
import type { ParsedReceipt, ReceiptItem } from "@/modules/receipts";

/**
 * The editable form of a scanned receipt.
 *
 * A `ParsedReceipt` holds `bigint` minor units, which is right for arithmetic
 * and wrong for a text input: someone half-way through typing "1" of "19.00"
 * does not have a valid amount, and a model that cannot hold that state loses
 * the keystroke. So the draft keeps every amount as the text in its field, and
 * converts on the way out.
 *
 * Pure, and kept out of the components, for the same reason
 * `expense-form-logic.ts` is: the conversions can then be tested without
 * rendering anything.
 */

export interface DraftItem {
  readonly id: string;
  readonly name: string;
  /** Text, so an empty field is a state rather than a zero. */
  readonly quantity: string;
  readonly amount: string;
  /** Whether the recognizer was unsure about the line this came from. */
  readonly uncertain: boolean;
}

export interface ReceiptDraft {
  readonly merchant: string;
  /** `YYYY-MM-DD`, as `<input type="date">` wants it. */
  readonly date: string;
  readonly currency: string;
  readonly items: readonly DraftItem[];
  readonly subtotal: string;
  readonly tax: string;
  readonly tip: string;
  readonly service: string;
  readonly total: string;
}

/**
 * Below this, a line is flagged for a second look.
 *
 * The number itself is never shown. A confidence of 0.61 means nothing to
 * someone splitting a dinner bill; "check this one" means everything.
 */
export const UNCERTAIN_BELOW = 0.75;

function amountText(value: bigint | undefined, currency: string): string {
  return value === undefined
    ? ""
    : formatMinorUnits(value.toString(), currency);
}

/** Turns a parsed receipt into something a form can hold. */
export function toDraft(
  receipt: ParsedReceipt,
  options: {
    readonly fallbackCurrency: string;
    /** Used when the receipt carried no date of its own. */
    readonly fallbackDate: string;
  },
): ReceiptDraft {
  const currency = receipt.currency ?? options.fallbackCurrency;

  return {
    merchant: receipt.merchant ?? "",
    date: receipt.date ?? options.fallbackDate,
    currency,
    items: receipt.items.map((item) => toDraftItem(item, currency)),
    subtotal: amountText(receipt.subtotal, currency),
    tax: amountText(receipt.tax, currency),
    tip: amountText(receipt.tip, currency),
    service: amountText(receipt.service, currency),
    total: amountText(receipt.total, currency),
  };
}

function toDraftItem(item: ReceiptItem, currency: string): DraftItem {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity && item.quantity > 1 ? String(item.quantity) : "",
    amount: amountText(item.total, currency),
    uncertain: (item.confidence ?? 1) < UNCERTAIN_BELOW,
  };
}

/** A blank row, for the item the scanner missed. */
export function emptyItem(id: string): DraftItem {
  return { id, name: "", quantity: "", amount: "", uncertain: false };
}

/**
 * Re-reads a draft's amounts.
 *
 * Rows whose amount does not parse are dropped rather than treated as zero: a
 * half-typed price must not silently become part of the split, and the total
 * is what the split is built from anyway.
 */
export function draftItems(
  draft: ReceiptDraft,
): readonly { id: string; name: string; total: bigint; quantity?: number }[] {
  const items: {
    id: string;
    name: string;
    total: bigint;
    quantity?: number;
  }[] = [];

  for (const item of draft.items) {
    const parsed = parseAmountToMinor(item.amount, draft.currency);
    if (!parsed.ok) continue;
    const quantity = Number.parseInt(item.quantity, 10);
    items.push({
      id: item.id,
      name: item.name.trim(),
      total: parsed.value,
      quantity:
        Number.isFinite(quantity) && quantity > 1 ? quantity : undefined,
    });
  }
  return items;
}

function optionalMinor(text: string, currency: string): bigint | undefined {
  if (text.trim() === "") return undefined;
  const parsed = parseAmountToMinor(text, currency);
  return parsed.ok ? parsed.value : undefined;
}

/**
 * The draft as a receipt again, for validation.
 *
 * This is what the reconciliation warnings are computed from, so they follow
 * the numbers on screen rather than the numbers OCR first proposed — correct a
 * misread price and the warning about it goes away.
 */
export function draftToReceipt(draft: ReceiptDraft): ParsedReceipt {
  return {
    merchant: draft.merchant.trim() || undefined,
    date: draft.date || undefined,
    currency: draft.currency,
    items: draftItems(draft).map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      total: item.total,
    })),
    subtotal: optionalMinor(draft.subtotal, draft.currency),
    tax: optionalMinor(draft.tax, draft.currency),
    tip: optionalMinor(draft.tip, draft.currency),
    service: optionalMinor(draft.service, draft.currency),
    total: optionalMinor(draft.total, draft.currency),
  };
}

/** The confirmed total, which everything downstream is built from. */
export function draftTotal(draft: ReceiptDraft): bigint | null {
  const parsed = parseAmountToMinor(draft.total, draft.currency);
  return parsed.ok ? parsed.value : null;
}

/**
 * Suggests a total for a receipt whose own total was not read.
 *
 * Only ever offered as a *suggestion* the user has to accept — filling the
 * field in automatically would put a number nobody read off the paper into the
 * expense, which is the one thing this feature must not do.
 */
export function suggestedTotal(draft: ReceiptDraft): bigint | null {
  const items = draftItems(draft);
  if (items.length === 0) return null;

  const base = items.reduce((sum, item) => sum + item.total, 0n);
  const extras =
    (optionalMinor(draft.tax, draft.currency) ?? 0n) +
    (optionalMinor(draft.tip, draft.currency) ?? 0n) +
    (optionalMinor(draft.service, draft.currency) ?? 0n);
  return base + extras;
}
