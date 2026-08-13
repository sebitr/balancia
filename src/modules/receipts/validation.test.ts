import { describe, expect, it } from "vitest";
import { hasBlockingIssues, validateReceipt } from "./validation";
import type { ParsedReceipt, ReceiptItem } from "./types";

function item(total: bigint, id = `i${total}`): ReceiptItem {
  return { id, name: id, total };
}

const CONSISTENT: ParsedReceipt = {
  items: [item(1900n), item(2450n), item(1400n), item(950n)],
  subtotal: 6700n,
  tax: 510n,
  total: 7210n,
};

function codes(receipt: ParsedReceipt) {
  return validateReceipt(receipt).map((issue) => issue.code);
}

describe("validateReceipt", () => {
  it("reports nothing when the receipt adds up", () => {
    expect(validateReceipt(CONSISTENT)).toEqual([]);
  });

  it("tolerates rounding of a couple of minor units", () => {
    // Swiss cash rounding moves a total by up to two rappen.
    expect(validateReceipt({ ...CONSISTENT, total: 7212n })).toEqual([]);
  });

  it("reports items that do not add up to the subtotal", () => {
    const receipt = { ...CONSISTENT, items: [item(1900n), item(2450n)] };
    expect(codes(receipt)).toContain("itemsMissingSubtotal");
  });

  it("reports parts that do not add up to the total", () => {
    expect(codes({ ...CONSISTENT, tax: 900n })).toContain("partsMissingTotal");
  });

  it("reports items that exceed the total", () => {
    const receipt: ParsedReceipt = {
      items: [item(5000n), item(5000n)],
      total: 7210n,
    };
    expect(codes(receipt)).toContain("itemsExceedTotal");
  });

  it("accepts a service charge that is already inside the subtotal", () => {
    // A Milanese till: items 254.00, coperto 10.00, `Totale parziale` 264.00
    // — the cover charge is counted in the subtotal, not added after it. Both
    // layouts are common, and warning on a receipt that was read perfectly is
    // how people learn to dismiss warnings.
    const receipt: ParsedReceipt = {
      items: [item(25400n)],
      service: 1000n,
      subtotal: 26400n,
      tax: 2640n,
      total: 29040n,
    };
    expect(validateReceipt(receipt)).toEqual([]);
  });

  it("still accepts a service charge added after the subtotal", () => {
    const receipt: ParsedReceipt = {
      items: [item(25400n)],
      service: 1000n,
      subtotal: 25400n,
      tax: 2640n,
      total: 29040n,
    };
    expect(validateReceipt(receipt)).toEqual([]);
  });

  it("still catches a receipt that reconciles under neither reading", () => {
    // A real generated receipt whose own arithmetic is wrong: the items come
    // to 59.50 against a printed subtotal of 47.50.
    const receipt: ParsedReceipt = {
      items: [item(2400n), item(2200n), item(750n), item(600n)],
      subtotal: 4750n,
      tax: 380n,
      total: 5130n,
    };
    expect(codes(receipt)).toContain("itemsMissingSubtotal");
  });

  it("reports a missing total", () => {
    expect(codes({ items: [item(1900n)] })).toContain("noTotal");
  });

  it("reports a receipt with no items as information, not a warning", () => {
    const issues = validateReceipt({ items: [], total: 7210n });
    const noItems = issues.find((issue) => issue.code === "noItems");
    expect(noItems?.severity).toBe("info");
  });

  it("reports a negative total", () => {
    expect(codes({ items: [], total: -100n })).toContain("negativeTotal");
  });

  it("carries the numbers so the UI can name them", () => {
    const [issue] = validateReceipt({
      items: [item(6850n)],
      subtotal: 6700n,
      total: 6700n,
    });
    expect(issue.code).toBe("itemsMissingSubtotal");
    expect(issue.params).toMatchObject({
      items: "6850",
      subtotal: "6700",
      difference: "150",
    });
  });

  it("does not report the same discrepancy twice", () => {
    // Items disagree with the subtotal, but the subtotal, tax and total are
    // mutually consistent — so there is one finding, not two.
    const receipt: ParsedReceipt = {
      items: [item(6850n)],
      subtotal: 6700n,
      tax: 510n,
      total: 7210n,
    };
    expect(codes(receipt)).toEqual(["itemsMissingSubtotal"]);
  });

  it("accepts a custom tolerance", () => {
    const receipt = { ...CONSISTENT, total: 7215n };
    expect(validateReceipt(receipt, { toleranceMinorUnits: 10n })).toEqual([]);
    expect(validateReceipt(receipt, { toleranceMinorUnits: 1n })).not.toEqual(
      [],
    );
  });

  it("never rewrites the receipt to make it reconcile", () => {
    const receipt = { ...CONSISTENT, tax: 900n };
    validateReceipt(receipt);
    expect(receipt.tax).toBe(900n);
    expect(receipt.total).toBe(7210n);
  });
});

describe("hasBlockingIssues", () => {
  it("is false for an empty list and for information only", () => {
    expect(hasBlockingIssues([])).toBe(false);
    expect(hasBlockingIssues(validateReceipt({ items: [], total: 100n }))).toBe(
      false,
    );
  });

  it("is true when something does not reconcile", () => {
    expect(
      hasBlockingIssues(validateReceipt({ ...CONSISTENT, tax: 900n })),
    ).toBe(true);
  });
});
