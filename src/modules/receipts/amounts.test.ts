import { describe, expect, it } from "vitest";
import { findAmounts, hasDecimalPart, parseReceiptAmount } from "./amounts";

/**
 * The decimal separator is the single most dangerous thing on a receipt: read
 * `1.234` as twelve-thirty-four instead of twelve-hundred-and-thirty-four and
 * the split is wrong by two orders of magnitude, with nothing on screen looking
 * obviously broken. Hence the size of this file.
 */

describe("parseReceiptAmount", () => {
  describe("decimal separators", () => {
    it("reads a dot as a decimal point", () => {
      expect(parseReceiptAmount("12.50", "CHF")).toBe(1250n);
    });

    it("reads a comma as a decimal point", () => {
      expect(parseReceiptAmount("12,50", "EUR")).toBe(1250n);
    });

    it("reads Swiss apostrophe grouping", () => {
      expect(parseReceiptAmount("1'234.50", "CHF")).toBe(123450n);
      expect(parseReceiptAmount("1’234.50", "CHF")).toBe(123450n);
    });

    it("reads space grouping with a comma decimal", () => {
      expect(parseReceiptAmount("1 234,50", "EUR")).toBe(123450n);
      expect(parseReceiptAmount("1 234,50", "EUR")).toBe(123450n);
      expect(parseReceiptAmount("1 234,50", "EUR")).toBe(123450n);
    });

    it("reads US grouping", () => {
      expect(parseReceiptAmount("1,234.50", "USD")).toBe(123450n);
      expect(parseReceiptAmount("12,345.67", "USD")).toBe(1234567n);
    });

    it("reads European grouping", () => {
      expect(parseReceiptAmount("1.234,50", "EUR")).toBe(123450n);
      expect(parseReceiptAmount("1.234.567,89", "EUR")).toBe(123456789n);
    });

    it("treats a lone separator with three digits as grouping", () => {
      // `1.234` is one thousand two hundred and thirty-four everywhere that
      // writes it that way, and nowhere is it 1.234 of anything spendable.
      expect(parseReceiptAmount("1.234", "EUR")).toBe(123400n);
      expect(parseReceiptAmount("1,234", "USD")).toBe(123400n);
    });

    it("pads a single decimal digit", () => {
      expect(parseReceiptAmount("9.5", "CHF")).toBe(950n);
      expect(parseReceiptAmount("9,5", "EUR")).toBe(950n);
    });

    it("reads an integer with no separator at all", () => {
      expect(parseReceiptAmount("19", "CHF")).toBe(1900n);
      expect(parseReceiptAmount("1234", "EUR")).toBe(123400n);
    });
  });

  describe("currencies with a different exponent", () => {
    it("treats three decimals as a decimal part for three-digit currencies", () => {
      expect(parseReceiptAmount("1.234", "BHD")).toBe(1234n);
      expect(parseReceiptAmount("12,500", "TND")).toBe(12500n);
    });

    it("reads the last mark as the decimal point when both appear", () => {
      // 1234 dinars and 500 fils, not one and a quarter million.
      expect(parseReceiptAmount("1,234.500", "BHD")).toBe(1234500n);
    });

    it("treats a lone three-digit tail as grouping in two-digit currencies", () => {
      // `72.100` is seventy-two thousand one hundred where a dot groups.
      expect(parseReceiptAmount("72.100", "CHF")).toBe(7210000n);
    });

    it("reads currencies with no minor unit", () => {
      expect(parseReceiptAmount("1,050", "JPY")).toBe(1050n);
      expect(parseReceiptAmount("1050", "JPY")).toBe(1050n);
    });
  });

  describe("signs", () => {
    it("reads a leading minus", () => {
      expect(parseReceiptAmount("-5.00", "CHF")).toBe(-500n);
    });

    it("reads the European trailing minus", () => {
      expect(parseReceiptAmount("5,00-", "EUR")).toBe(-500n);
    });

    it("reads parentheses as negative", () => {
      expect(parseReceiptAmount("(5.00)", "USD")).toBe(-500n);
    });
  });

  describe("rejections", () => {
    it("rejects dates", () => {
      expect(parseReceiptAmount("13.08.2026", "CHF")).toBeNull();
      expect(parseReceiptAmount("2026-08-13", "CHF")).toBeNull();
    });

    it("rejects times", () => {
      expect(parseReceiptAmount("20:14", "CHF")).toBeNull();
    });

    it("rejects malformed grouping", () => {
      expect(parseReceiptAmount("1.23.456", "EUR")).toBeNull();
      expect(parseReceiptAmount("12,34,567", "USD")).toBeNull();
    });

    it("rejects more precision than the currency has", () => {
      expect(parseReceiptAmount("12.5678", "CHF")).toBeNull();
      // Three decimals in a two-decimal currency, and the third is not padding.
      expect(parseReceiptAmount("1,234.567", "CHF")).toBeNull();
    });

    it("accepts trailing zeros beyond the currency's precision", () => {
      // A currency with no minor unit, printed with a decimal column anyway.
      expect(parseReceiptAmount("1,050.00", "JPY")).toBe(1050n);
      expect(parseReceiptAmount("1.234,00", "EUR")).toBe(123400n);
    });

    it("rejects text", () => {
      expect(parseReceiptAmount("", "CHF")).toBeNull();
      expect(parseReceiptAmount("total", "CHF")).toBeNull();
      expect(parseReceiptAmount("12.50 CHF", "CHF")).toBeNull();
    });
  });
});

describe("findAmounts", () => {
  it("finds the price at the end of an item line", () => {
    const found = findAmounts("Margherita 19.00", "CHF");
    expect(found).toHaveLength(1);
    expect(found[0].amount).toBe(1900n);
  });

  it("finds a quantity and a price separately", () => {
    const found = findAmounts("2 x Bier 14.00", "CHF");
    expect(found.map((entry) => entry.amount)).toEqual([200n, 1400n]);
  });

  it("finds the rate and the amount on a tax line", () => {
    const found = findAmounts("MwSt 7.7% 5.10", "CHF");
    expect(found.at(-1)?.amount).toBe(510n);
  });

  it("skips a date but still finds the amount after it", () => {
    const found = findAmounts("13.08.2026 Total 72.10", "CHF");
    expect(found.map((entry) => entry.amount)).toEqual([7210n]);
  });

  it("does not weld a size onto the price that follows it", () => {
    // From a real scan: `2 Vino rosso cl.75 36,00` came back as one amount of
    // 7536.00, because a space was treated as a thousands separator without
    // checking that three digits followed it.
    const found = findAmounts("2 Vino rosso cl.75 36,00", "EUR");
    expect(found.at(-1)?.amount).toBe(3600n);
    expect(found.map((entry) => entry.amount)).not.toContain(753600n);
  });

  it("still reads a space as a thousands separator when it is one", () => {
    expect(findAmounts("Total 1 234,50", "EUR").at(-1)?.amount).toBe(123450n);
  });

  it("keeps a phone number from becoming a price", () => {
    const found = findAmounts("Tel. 02 8901 2345", "EUR");
    expect(found.map((entry) => entry.amount)).not.toContain(289012345n);
  });

  it("returns nothing for a line with no numbers", () => {
    expect(findAmounts("Thank you", "CHF")).toHaveLength(0);
  });

  it("reports where each amount was found", () => {
    const line = "Carbonara 24.50";
    const [match] = findAmounts(line, "CHF");
    expect(line.slice(match.index, match.index + match.text.length)).toBe(
      "24.50",
    );
  });
});

describe("hasDecimalPart", () => {
  it("recognizes prices", () => {
    expect(hasDecimalPart("19.00")).toBe(true);
    expect(hasDecimalPart("19,00")).toBe(true);
    expect(hasDecimalPart("1'234.50")).toBe(true);
  });

  it("rejects bare integers and grouped thousands", () => {
    expect(hasDecimalPart("12")).toBe(false);
    expect(hasDecimalPart("1,234")).toBe(false);
  });
});
