import { describe, expect, it } from "vitest";
import {
  RECEIPT_INSTRUCTIONS,
  extractJson,
  receiptReplySchema,
  toParsedReceipt,
} from "./reply";

/**
 * The provider-facing half of receipt reading, tested without a network.
 *
 * These are the cases a model actually produces — a fenced reply, a stray
 * key, a number where a string was asked for, an amount in a convention the
 * reader did not expect. Every driver funnels through this file, so a bug
 * here is a bug in all three.
 */

const parse = (value: unknown) => {
  const result = receiptReplySchema.safeParse(value);
  if (!result.success) throw new Error("schema rejected the reply");
  return result.data;
};

const read = (value: unknown, currency = "EUR") =>
  toParsedReceipt(parse(value), { fallbackCurrency: currency });

describe("extractJson", () => {
  it("reads a bare object", () => {
    expect(extractJson('{"total":"12.50"}')).toEqual({ total: "12.50" });
  });

  it("reads a fenced object, labelled or not", () => {
    expect(extractJson('```json\n{"total":"1"}\n```')).toEqual({ total: "1" });
    expect(extractJson('```\n{"total":"1"}\n```')).toEqual({ total: "1" });
  });

  /** Models preface. Asking them not to only mostly works. */
  it("reads an object behind a sentence of preamble", () => {
    expect(extractJson('Here is the receipt:\n\n{"total":"9.90"}')).toEqual({
      total: "9.90",
    });
  });

  /**
   * A model with thinking disabled can leak its reasoning tags into the
   * visible answer. The brace scan steps over them.
   */
  it("reads an object after a leaked thinking tag", () => {
    expect(
      extractJson(
        '<thinking>the total is at the bottom</thinking>{"total":"4"}',
      ),
    ).toEqual({ total: "4" });
  });

  it("returns undefined when there is no object at all", () => {
    expect(extractJson("I could not read that image.")).toBeUndefined();
    expect(extractJson("")).toBeUndefined();
  });
});

describe("the reply schema", () => {
  it("accepts a reply with keys nobody asked for", () => {
    const reply = parse({ total: "10.00", confidence: 0.9, notes: "blurry" });
    expect(reply.total).toBe("10.00");
  });

  it("treats null, empty and missing as the same absence", () => {
    const receipt = read({ merchant: null, date: "", items: null });
    expect(receipt.merchant).toBeUndefined();
    expect(receipt.date).toBeUndefined();
    expect(receipt.items).toEqual([]);
  });
});

describe("amounts", () => {
  /**
   * The whole reason amounts cross the wire as strings. Each of these is an
   * ordinary way to write the same money, and `parseFloat` is wrong about
   * three of them.
   */
  it.each([
    ["12.50", 1250n],
    ["12,50", 1250n],
    ["1.234,50", 123450n],
    ["1,234.50", 123450n],
    ["1'234.50", 123450n],
    ["1 234,50", 123450n],
    ["1.234", 123400n],
  ])("reads %s the way the receipt meant it", (printed, minor) => {
    expect(read({ total: printed }).total).toBe(minor);
  });

  it("keeps a credit negative", () => {
    expect(read({ total: "12,50-" }).total).toBe(-1250n);
  });

  /**
   * A model that ignores the instruction and sends a number gets a different
   * path: the JSON value is already decimal, so running the separator rule
   * over it would turn 1.234 into a thousand.
   */
  it("reads a JSON number as a decimal, not as grouped digits", () => {
    expect(read({ total: 1.234 }, "BHD").total).toBe(1234n); // 3 decimals
    expect(read({ total: 12.5 }).total).toBe(1250n);
    expect(read({ total: 0 }).total).toBe(0n);
  });

  it("drops an amount it cannot read rather than guessing", () => {
    expect(read({ total: "about twelve euros" }).total).toBeUndefined();
    expect(read({ total: "12.34.56" }).total).toBeUndefined();
  });

  it("honours the currency's exponent", () => {
    expect(read({ total: "1000" }, "JPY").total).toBe(1000n); // 0 decimals
  });
});

describe("items", () => {
  it("numbers items from one, in order", () => {
    const receipt = read({
      items: [
        { name: "Margherita", total: "19.00" },
        { name: "Beer", quantity: 2, unitPrice: "7.00", total: "14.00" },
      ],
    });
    expect(receipt.items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
    expect(receipt.items[1]).toMatchObject({
      name: "Beer",
      quantity: 2,
      unitPrice: 700n,
      total: 1400n,
    });
  });

  /** An item nobody can price cannot be assigned to anybody. */
  it("drops an item with no readable total, and renumbers around it", () => {
    const receipt = read({
      items: [
        { name: "Bread", total: "3.00" },
        { name: "Illegible", total: "???" },
        { name: "Milk", total: "1.20" },
      ],
    });
    expect(receipt.items.map((item) => item.name)).toEqual(["Bread", "Milk"]);
    expect(receipt.items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
  });

  it("drops a nameless item", () => {
    expect(read({ items: [{ name: "", total: "3.00" }] }).items).toEqual([]);
  });

  it("keeps a discount line as a negative item", () => {
    const receipt = read({ items: [{ name: "Loyalty", total: "-2.00" }] });
    expect(receipt.items[0]?.total).toBe(-200n);
  });

  it("ignores a nonsense quantity", () => {
    const receipt = read({
      items: [{ name: "Bread", quantity: 0, total: "3.00" }],
    });
    expect(receipt.items[0]?.quantity).toBeUndefined();
  });
});

describe("the rest of the receipt", () => {
  it("reads a date in whatever shape it was printed", () => {
    expect(read({ date: "13.08.2026" }).date).toBe("2026-08-13");
    expect(read({ date: "2026-08-13" }).date).toBe("2026-08-13");
  });

  it("drops a date that is not one", () => {
    expect(read({ date: "yesterday" }).date).toBeUndefined();
    expect(read({ date: "32.13.2026" }).date).toBeUndefined();
  });

  it("takes a currency only when it looks like a code", () => {
    expect(read({ currency: "chf" }).currency).toBe("CHF");
    expect(read({ currency: "Swiss francs" }).currency).toBeUndefined();
  });

  /** The currency decides the exponent even when it came from the reply. */
  it("reads amounts in the currency the receipt named", () => {
    expect(read({ currency: "JPY", total: "1000" }, "EUR").total).toBe(1000n);
  });

  it("collapses a multi-line merchant rather than truncating it", () => {
    expect(read({ merchant: "  ACME\n Ltd  " }).merchant).toBe("ACME Ltd");
  });

  it("bounds a merchant that ran away with the address block", () => {
    const receipt = read({ merchant: "A".repeat(400) });
    expect(receipt.merchant?.length).toBe(120);
  });

  it("carries the summary rows through", () => {
    const receipt = read({
      subtotal: "19.00",
      tax: "1.52",
      tip: "2.00",
      service: "0.50",
      total: "23.02",
    });
    expect(receipt).toMatchObject({
      subtotal: 1900n,
      tax: 152n,
      tip: 200n,
      service: 50n,
      total: 2302n,
    });
  });
});

describe("the instructions", () => {
  /**
   * The prompt and the parser are one contract. If the prompt stops asking
   * for verbatim amounts, `amounts.ts` starts being handed numbers it cannot
   * reason about — and the failure is a wrong total, not an error.
   */
  it("still asks for amounts exactly as printed", () => {
    expect(RECEIPT_INSTRUCTIONS).toMatch(/EXACTLY as printed/);
    expect(RECEIPT_INSTRUCTIONS).toMatch(/do not turn them into numbers/i);
  });

  it("still names every field the schema reads", () => {
    for (const field of [
      "merchant",
      "date",
      "currency",
      "items",
      "subtotal",
      "tax",
      "tip",
      "service",
      "total",
    ]) {
      expect(RECEIPT_INSTRUCTIONS).toContain(`"${field}"`);
    }
  });

  it("still tells the model not to invent anything", () => {
    // Wrapped across a line in the prompt, hence the loose whitespace.
    expect(RECEIPT_INSTRUCTIONS).toMatch(/[Nn]ever\s+invent/);
  });
});
