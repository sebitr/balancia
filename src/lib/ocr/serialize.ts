/**
 * A `ParsedReceipt` across the wire.
 *
 * Amounts in Balancia are `bigint`, and `JSON.stringify` throws on one rather
 * than rounding it — which is the right behaviour and the reason this file
 * exists. They travel as decimal strings and come back as `bigint`, so the
 * browser reassembles exactly the receipt the server read, with no `number`
 * anywhere in between.
 *
 * Pure, and tested as a round trip: the remote reader is only as trustworthy
 * as the transport under it.
 */
import type { ParsedReceipt, ReceiptItem } from "@/modules/receipts";

/** Minor units as a decimal string, or absent. */
type WireAmount = string | undefined;

export interface WireReceiptItem {
  readonly id: string;
  readonly name: string;
  readonly quantity?: number;
  readonly unitPrice?: WireAmount;
  readonly total: string;
  readonly confidence?: number;
}

export interface WireReceipt {
  readonly merchant?: string;
  readonly date?: string;
  readonly currency?: string;
  readonly items: readonly WireReceiptItem[];
  readonly subtotal?: WireAmount;
  readonly tax?: WireAmount;
  readonly tip?: WireAmount;
  readonly service?: WireAmount;
  readonly total?: WireAmount;
  readonly confidence?: number;
}

const out = (value: bigint | undefined): WireAmount =>
  value === undefined ? undefined : value.toString();

/**
 * Reads a decimal string back.
 *
 * Anything that is not an integer literal becomes `undefined` rather than
 * throwing: this parses a response, and a malformed field should cost that
 * field, not the whole scan.
 */
const back = (value: unknown): bigint | undefined => {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export function serializeParsedReceipt(receipt: ParsedReceipt): WireReceipt {
  return {
    merchant: receipt.merchant,
    date: receipt.date,
    currency: receipt.currency,
    items: receipt.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: out(item.unitPrice),
      total: item.total.toString(),
      confidence: item.confidence,
    })),
    subtotal: out(receipt.subtotal),
    tax: out(receipt.tax),
    tip: out(receipt.tip),
    service: out(receipt.service),
    total: out(receipt.total),
    confidence: receipt.confidence,
  };
}

export function deserializeParsedReceipt(wire: unknown): ParsedReceipt {
  const source = (wire ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(source.items) ? source.items : [];

  const items: ReceiptItem[] = [];
  for (const entry of rawItems) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const total = back(item.total);
    const name = text(item.name);
    // Same rule as the parser's: an item with no price or no name is not one.
    if (total === undefined || name === undefined) continue;

    items.push({
      id: text(item.id) ?? `item-${items.length + 1}`,
      name,
      quantity: typeof item.quantity === "number" ? item.quantity : undefined,
      unitPrice: back(item.unitPrice),
      total,
      confidence:
        typeof item.confidence === "number" ? item.confidence : undefined,
    });
  }

  return {
    merchant: text(source.merchant),
    date: text(source.date),
    currency: text(source.currency),
    items,
    subtotal: back(source.subtotal),
    tax: back(source.tax),
    tip: back(source.tip),
    service: back(source.service),
    total: back(source.total),
    confidence:
      typeof source.confidence === "number" ? source.confidence : undefined,
  };
}
