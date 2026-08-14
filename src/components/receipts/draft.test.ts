import { describe, expect, it } from "vitest";
import {
  draftItems,
  draftToReceipt,
  draftTotal,
  emptyItem,
  suggestedTotal,
  toDraft,
  UNCERTAIN_BELOW,
  type ReceiptDraft,
} from "./draft";
import type { ParsedReceipt } from "@/modules/receipts";

/**
 * The boundary between what OCR read and what the form holds.
 *
 * Both directions matter: a `bigint` has to become the text of an input
 * without losing precision, and half-typed text has to become numbers again
 * without inventing any.
 */

const OPTIONS = { fallbackCurrency: "CHF", fallbackDate: "2026-08-13" };

const SCANNED: ParsedReceipt = {
  merchant: "Casa Italia",
  date: "2026-08-13",
  currency: "CHF",
  items: [
    { id: "i1", name: "Margherita", total: 1900n, confidence: 0.98 },
    { id: "i2", name: "Bier", quantity: 2, total: 1400n, confidence: 0.61 },
  ],
  subtotal: 3300n,
  tax: 250n,
  total: 3550n,
};

describe("toDraft", () => {
  const draft = toDraft(SCANNED, OPTIONS);

  it("renders minor units as editable major-unit text", () => {
    expect(draft.total).toBe("35.50");
    expect(draft.subtotal).toBe("33.00");
    expect(draft.tax).toBe("2.50");
    expect(draft.items[0].amount).toBe("19.00");
  });

  it("keeps a quantity only when there is more than one", () => {
    expect(draft.items[0].quantity).toBe("");
    expect(draft.items[1].quantity).toBe("2");
  });

  it("flags the lines the recognizer was unsure about", () => {
    expect(draft.items[0].uncertain).toBe(false);
    expect(draft.items[1].uncertain).toBe(true);
    expect(SCANNED.items[1].confidence).toBeLessThan(UNCERTAIN_BELOW);
  });

  it("leaves amounts the scanner did not find empty rather than zero", () => {
    // An empty field says "not read". A zero says "this receipt had no tip",
    // which is a claim nobody made.
    const sparse = toDraft({ items: [] }, OPTIONS);
    expect(sparse.total).toBe("");
    expect(sparse.tip).toBe("");
  });

  it("falls back to the group's currency and today's date", () => {
    const sparse = toDraft({ items: [] }, OPTIONS);
    expect(sparse.currency).toBe("CHF");
    expect(sparse.date).toBe("2026-08-13");
  });

  it("prefers the currency the receipt named", () => {
    const draft = toDraft({ ...SCANNED, currency: "EUR" }, OPTIONS);
    expect(draft.currency).toBe("EUR");
  });
});

describe("draftItems", () => {
  const draft = toDraft(SCANNED, OPTIONS);

  it("reads the amounts back", () => {
    expect(draftItems(draft).map((item) => item.total)).toEqual([1900n, 1400n]);
  });

  it("ignores a row whose amount is half-typed", () => {
    // Treating "1" as 1.00 while someone types "19.00" would briefly put a
    // wrong number into the split preview.
    const typing: ReceiptDraft = {
      ...draft,
      items: [{ ...draft.items[0], amount: "" }, draft.items[1]],
    };
    expect(draftItems(typing)).toHaveLength(1);
  });

  it("ignores a quantity of one, and text that is not a number", () => {
    const odd: ReceiptDraft = {
      ...draft,
      items: [{ ...draft.items[0], quantity: "1" }],
    };
    expect(draftItems(odd)[0].quantity).toBeUndefined();
  });

  it("reads a row that was added by hand", () => {
    const added: ReceiptDraft = {
      ...draft,
      items: [
        ...draft.items,
        { ...emptyItem("new"), name: "Coffee", amount: "4.50" },
      ],
    };
    expect(draftItems(added).at(-1)?.total).toBe(450n);
  });
});

describe("draftTotal", () => {
  it("reads the confirmed total", () => {
    expect(draftTotal(toDraft(SCANNED, OPTIONS))).toBe(3550n);
  });

  it("is null while the field is empty or invalid", () => {
    const draft = toDraft(SCANNED, OPTIONS);
    expect(draftTotal({ ...draft, total: "" })).toBeNull();
    expect(draftTotal({ ...draft, total: "abc" })).toBeNull();
  });
});

describe("draftToReceipt", () => {
  it("round-trips the numbers", () => {
    const receipt = draftToReceipt(toDraft(SCANNED, OPTIONS));
    expect(receipt.total).toBe(3550n);
    expect(receipt.subtotal).toBe(3300n);
    expect(receipt.items.map((item) => item.total)).toEqual([1900n, 1400n]);
  });

  it("follows the fields rather than the original scan", () => {
    // Correcting a misread price must make the warning about it go away.
    const draft = toDraft(SCANNED, OPTIONS);
    const corrected = draftToReceipt({
      ...draft,
      items: [{ ...draft.items[0], amount: "19.60" }, draft.items[1]],
    });
    expect(corrected.items[0].total).toBe(1960n);
  });
});

describe("suggestedTotal", () => {
  const draft = toDraft(SCANNED, OPTIONS);

  it("adds the items and the charges", () => {
    expect(suggestedTotal({ ...draft, total: "" })).toBe(1900n + 1400n + 250n);
  });

  it("is null when there is nothing to add up", () => {
    expect(suggestedTotal(toDraft({ items: [] }, OPTIONS))).toBeNull();
  });

  it("is only ever a suggestion", () => {
    // The draft is not modified: filling the total in automatically would put
    // a number nobody read off the paper into the expense.
    const before = { ...draft, total: "" };
    suggestedTotal(before);
    expect(before.total).toBe("");
  });
});
