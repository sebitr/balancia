/**
 * The JSON a vision model is asked for, and how it becomes a `ParsedReceipt`.
 *
 * All three drivers ask for the same shape and share this file, so there is
 * one schema to argue with and one conversion to test. Nothing here talks to a
 * network: given a parsed JSON value it is a pure function, which is the whole
 * reason the drivers are thin.
 *
 * The important decision is that **amounts come back as strings, copied off
 * the receipt**, and are read by `parseReceiptAmount()`. A model asked for a
 * number has to decide what `1.234` means before we ever see it, and it
 * decides using the same weak evidence a naive `parseFloat` would. Asking for
 * the characters that are printed on the paper keeps that judgement in
 * `amounts.ts`, where it is one documented rule tested across conventions,
 * rather than in a model's head. Numbers are still accepted — models ignore
 * instructions — but they take a different path that does no guessing.
 */
import { z } from "zod";
import {
  parseReceiptAmount,
  parseReceiptDate,
  type ParsedReceipt,
  type ReceiptItem,
} from "@/modules/receipts";
import { currencyExponent } from "@/modules/currencies/iso-4217";

/**
 * What the model is told to produce.
 *
 * Kept as one exported constant because every driver sends it and the tests
 * assert against it: a prompt that drifts from the schema below is a bug that
 * only shows up as a mysteriously empty receipt.
 */
export const RECEIPT_INSTRUCTIONS = `You read photographs of receipts and return JSON. Return only JSON, with no explanation and no code fence.

{
  "merchant": string|null,     // the shop or restaurant name, not its address
  "date": string|null,         // as printed, e.g. "13.08.2026" or "2026-08-13"
  "currency": string|null,     // ISO 4217 code, only if the receipt names one
  "items": [
    {
      "name": string,          // the line's description, as printed
      "quantity": number|null, // only if the line states one
      "unitPrice": string|null,// only if the line states a per-unit price
      "total": string          // what this line costs in total
    }
  ],
  "subtotal": string|null,
  "tax": string|null,
  "tip": string|null,
  "service": string|null,
  "total": string|null         // the grand total actually payable
}

Rules:
- Copy every amount EXACTLY as printed, as a string, keeping the receipt's own
  separators: "12,50", "1'234.50" and "1 234,50" must come back unchanged. Do
  not convert them, do not reformat them, do not turn them into numbers.
- Include only real purchased lines in "items". Discounts printed as their own
  line are items with a negative amount. Subtotals, tax, tip, service, change,
  loyalty points and card-payment lines are not items.
- Use null for anything the receipt does not show or you cannot read. Never
  invent a value, and never compute one that is not printed.`;

/** Tolerant on purpose: models emit nulls, empty strings and stray keys. */
const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined) return undefined;
    const trimmed = String(value).trim();
    return trimmed === "" ? undefined : trimmed;
  });

const rawAmount = z.union([z.string(), z.number()]).nullish();

const itemSchema = z.object({
  name: text,
  quantity: z.number().nullish(),
  unitPrice: rawAmount,
  total: rawAmount,
});

/**
 * Not `.strict()`. A model that adds `"confidence"` or `"notes"` has still
 * answered the question, and failing the whole scan over an extra key would
 * turn a good read into "try again".
 */
export const receiptReplySchema = z.object({
  merchant: text,
  date: text,
  currency: text,
  items: z.array(itemSchema).nullish(),
  subtotal: rawAmount,
  tax: rawAmount,
  tip: rawAmount,
  service: rawAmount,
  total: rawAmount,
});

export type ReceiptReply = z.infer<typeof receiptReplySchema>;

/**
 * A JSON number straight to minor units, with no separator heuristic.
 *
 * `toFixed` has already put exactly as many decimals as the currency has, so
 * removing the point is exact — no float multiplication, and no chance of the
 * three-digit grouping rule mistaking `1.234` in a three-decimal currency for
 * a thousand.
 */
function fromNumber(value: number, currency: string): bigint | null {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) return null;
  const fixed = value.toFixed(currencyExponent(currency));
  try {
    return BigInt(fixed.replace(".", ""));
  } catch {
    return null;
  }
}

/** Either path, depending on what the model actually sent. */
function toMinorUnits(
  value: string | number | null | undefined,
  currency: string,
): bigint | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number")
    return fromNumber(value, currency) ?? undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return parseReceiptAmount(trimmed, currency) ?? undefined;
}

/** ISO 4217 codes are three letters; anything else is not one. */
function toCurrency(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : undefined;
}

/**
 * A merchant name, or nothing.
 *
 * Bounded because it becomes the expense description, and a model that decides
 * to return the whole header block should not produce an expense titled with
 * three lines of address. Newlines collapse rather than truncate the value, so
 * "ACME\nLtd" survives as "ACME Ltd".
 */
function toMerchant(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  return collapsed.length > 120 ? collapsed.slice(0, 120).trim() : collapsed;
}

/**
 * Turns a validated reply into a receipt.
 *
 * Never throws and never invents: a field the model could not read, or read as
 * something that is not an amount, arrives here as `undefined` and stays that
 * way. The review screen is built for a receipt with holes in it, and an
 * honest hole is better than a plausible number.
 */
export function toParsedReceipt(
  reply: ReceiptReply,
  options: { readonly fallbackCurrency: string },
): ParsedReceipt {
  const currency = toCurrency(reply.currency) ?? options.fallbackCurrency;
  const amount = (value: string | number | null | undefined) =>
    toMinorUnits(value, currency);

  const items: ReceiptItem[] = [];
  for (const item of reply.items ?? []) {
    const total = amount(item.total);
    // A line with no readable amount cannot be assigned to anyone, and a
    // nameless one cannot be recognised. Either way there is nothing to show.
    if (total === undefined || !item.name) continue;

    const quantity =
      typeof item.quantity === "number" &&
      Number.isFinite(item.quantity) &&
      item.quantity > 0
        ? item.quantity
        : undefined;

    items.push({
      id: `item-${items.length + 1}`,
      name: item.name,
      quantity,
      unitPrice: amount(item.unitPrice),
      total,
    });
  }

  return {
    merchant: toMerchant(reply.merchant),
    date: reply.date ? (parseReceiptDate(reply.date) ?? undefined) : undefined,
    currency: toCurrency(reply.currency),
    items,
    subtotal: amount(reply.subtotal),
    tax: amount(reply.tax),
    tip: amount(reply.tip),
    service: amount(reply.service),
    total: amount(reply.total),
  };
}

/**
 * Pulls the JSON object out of whatever the model wrapped it in.
 *
 * Asking for bare JSON mostly works. What arrives when it does not is a code
 * fence, or a sentence of preamble before the brace — both cheap to recover
 * from, and both otherwise a failed scan for a read that actually succeeded.
 */
export function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  const candidate = (fenced?.[1] ?? content).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to the brace scan.
  }

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
