import { describe, expect, it } from "vitest";
import type { ParsedReceipt } from "@/modules/receipts";
import { deserializeParsedReceipt, serializeParsedReceipt } from "./serialize";

/**
 * The transport under the remote reader.
 *
 * A receipt that survives the round trip unchanged is the whole requirement:
 * the browser has to reassemble exactly what the server read, with no
 * `number` in the middle to round a total.
 */

const receipt: ParsedReceipt = {
  merchant: "Trattoria",
  date: "2026-08-13",
  currency: "EUR",
  items: [
    { id: "item-1", name: "Margherita", total: 1900n },
    {
      id: "item-2",
      name: "Beer",
      quantity: 2,
      unitPrice: 700n,
      total: 1400n,
      confidence: 0.82,
    },
    { id: "item-3", name: "Loyalty", total: -200n },
  ],
  subtotal: 3100n,
  tax: 248n,
  total: 3348n,
};

const roundTrip = (value: ParsedReceipt) =>
  deserializeParsedReceipt(
    JSON.parse(JSON.stringify(serializeParsedReceipt(value))),
  );

describe("the receipt wire format", () => {
  it("returns the same receipt it was given", () => {
    expect(roundTrip(receipt)).toEqual(receipt);
  });

  it("survives an amount no double could hold", () => {
    const huge = { ...receipt, total: 9_007_199_254_740_993n };
    expect(roundTrip(huge).total).toBe(9_007_199_254_740_993n);
  });

  it("keeps a negative amount negative", () => {
    expect(roundTrip(receipt).items[2]?.total).toBe(-200n);
  });

  it("keeps absent fields absent rather than inventing zeroes", () => {
    const sparse: ParsedReceipt = { items: [] };
    const back = roundTrip(sparse);
    expect(back).toEqual({ items: [] });
    expect(back.total).toBeUndefined();
  });

  /** `JSON.stringify` throws on a bigint, which is why any of this exists. */
  it("produces something JSON can actually carry", () => {
    expect(() => JSON.stringify(serializeParsedReceipt(receipt))).not.toThrow();
    expect(serializeParsedReceipt(receipt).total).toBe("3348");
  });
});

describe("reading a reply that is not one", () => {
  it("survives rubbish without throwing", () => {
    for (const value of [null, undefined, 42, "receipt", [], {}]) {
      expect(deserializeParsedReceipt(value)).toEqual({ items: [] });
    }
  });

  it("drops a field it cannot read rather than the whole receipt", () => {
    const back = deserializeParsedReceipt({
      merchant: "Trattoria",
      total: "12.50", // decimal where minor units were promised
      tax: "abc",
      subtotal: 100, // a number, not the agreed string
      items: [],
    });
    expect(back.merchant).toBe("Trattoria");
    expect(back.total).toBeUndefined();
    expect(back.tax).toBeUndefined();
    expect(back.subtotal).toBeUndefined();
  });

  it("drops an item with no price or no name, and still numbers the rest", () => {
    const back = deserializeParsedReceipt({
      items: [
        { id: "item-1", name: "Bread", total: "300" },
        { id: "item-2", name: "Broken", total: "?" },
        { id: "item-3", name: "", total: "120" },
        { name: "Milk", total: "120" },
      ],
    });
    expect(back.items.map((item) => item.name)).toEqual(["Bread", "Milk"]);
    // The nameless entry had an id; the last one did not, and gets one.
    expect(back.items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
  });
});
