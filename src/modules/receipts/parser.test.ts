import { describe, expect, it } from "vitest";
import { parseReceipt } from "./parser";
import { validateReceipt } from "./validation";
import {
  buildOcrResult,
  FRENCH_BISTRO,
  GERMAN_RESTAURANT,
  ITALIAN_TRATTORIA,
  LARGE_AMOUNTS,
  POORLY_DETECTED,
  QUANTITY_AND_SERVICE,
  SWISS_RESTAURANT,
  US_RESTAURANT,
  type FixtureLine,
} from "./test-fixtures";

/**
 * The readable specification for receipt parsing.
 *
 * Each fixture is a layout Balancia has to survive, and the assertions say what
 * a person reading that receipt would say the numbers are. Where the parser is
 * allowed to be unsure, the test says that too — a receipt with no total is a
 * supported outcome, not a failure.
 */

function parse(lines: readonly FixtureLine[], currency = "CHF") {
  return parseReceipt(buildOcrResult(lines), { fallbackCurrency: currency });
}

describe("parseReceipt", () => {
  describe("Swiss restaurant receipt", () => {
    const receipt = parse(SWISS_RESTAURANT);

    it("reads the merchant", () => {
      expect(receipt.merchant).toBe("Casa Italia");
    });

    it("reads the date", () => {
      expect(receipt.date).toBe("2026-08-13");
    });

    it("reads the currency the receipt names", () => {
      expect(receipt.currency).toBe("CHF");
    });

    it("reads every item with its price", () => {
      expect(
        receipt.items.map((item) => [item.name, item.total.toString()]),
      ).toEqual([
        ["Margherita", "1900"],
        ["Carbonara", "2450"],
        ["Bier", "1400"],
        ["Tiramisu", "950"],
      ]);
    });

    it("reads the quantity out of the description", () => {
      const beer = receipt.items.find((item) => item.name === "Bier");
      expect(beer?.quantity).toBe(2);
    });

    it("reads the summary rows", () => {
      expect(receipt.subtotal).toBe(6700n);
      expect(receipt.tax).toBe(510n);
      expect(receipt.total).toBe(7210n);
    });

    it("does not mistake the cash tendered or the change for the total", () => {
      // `Bar 80.00` and `Rueckgeld 7.90` sit below the total; reading either
      // as the bill would overcharge or undercharge the table.
      expect(receipt.total).toBe(7210n);
    });

    it("reconciles", () => {
      expect(validateReceipt(receipt)).toEqual([]);
    });
  });

  describe("French bistro receipt", () => {
    const receipt = parse(FRENCH_BISTRO, "EUR");

    it("reads comma decimals", () => {
      expect(receipt.items.map((item) => item.total.toString())).toEqual([
        "2650",
        "1200",
        "1800",
        "850",
      ]);
    });

    it("reads sous-total as the subtotal, not the total", () => {
      expect(receipt.subtotal).toBe(6500n);
      expect(receipt.total).toBe(7150n);
    });

    it("reads TVA as tax", () => {
      expect(receipt.tax).toBe(650n);
    });

    it("reconciles", () => {
      expect(validateReceipt(receipt)).toEqual([]);
    });
  });

  describe("German receipt", () => {
    const receipt = parse(GERMAN_RESTAURANT, "EUR");

    it("reads Zwischensumme as the subtotal and Gesamtbetrag as the total", () => {
      expect(receipt.subtotal).toBe(3920n);
      expect(receipt.total).toBe(4665n);
      expect(receipt.tax).toBe(745n);
    });

    it("reads the quantity prefix", () => {
      const beer = receipt.items.find((item) => item.name === "Weissbier");
      expect(beer?.quantity).toBe(3);
      expect(beer?.total).toBe(1350n);
    });

    it("does not read the invoice number as an amount", () => {
      expect(receipt.items.some((item) => item.name.includes("Rechnung"))).toBe(
        false,
      );
    });
  });

  describe("Italian trattoria receipt", () => {
    const receipt = parse(ITALIAN_TRATTORIA, "EUR");

    it("reads totale parziale as the subtotal", () => {
      expect(receipt.subtotal).toBe(3800n);
    });

    it("reads coperto as a service charge", () => {
      expect(receipt.service).toBe(400n);
    });

    it("reads IVA as tax and TOTALE as the total", () => {
      expect(receipt.tax).toBe(420n);
      expect(receipt.total).toBe(4620n);
    });

    it("reconciles subtotal plus cover plus tax against the total", () => {
      expect(validateReceipt(receipt)).toEqual([]);
    });
  });

  describe("US restaurant receipt", () => {
    const receipt = parse(US_RESTAURANT, "USD");

    it("detects dollars", () => {
      expect(receipt.currency).toBe("USD");
    });

    it("reads the tip", () => {
      expect(receipt.tip).toBe(710n);
    });

    it("reads subtotal, tax and total", () => {
      expect(receipt.subtotal).toBe(3550n);
      expect(receipt.tax).toBe(311n);
      expect(receipt.total).toBe(4571n);
    });

    it("does not read the table number or the server as items", () => {
      const names = receipt.items.map((item) => item.name);
      expect(names).not.toContain("Table");
      expect(names.some((name) => name.includes("Server"))).toBe(false);
    });

    it("does not read the card payment line as the total", () => {
      expect(receipt.total).toBe(4571n);
    });

    it("reads a month-name date", () => {
      expect(receipt.date).toBe("2026-08-13");
    });
  });

  describe("quantity with a unit price, and a service charge", () => {
    const receipt = parse(QUANTITY_AND_SERVICE);

    it("reads the unit price when it multiplies out", () => {
      const oysters = receipt.items[0];
      expect(oysters.quantity).toBe(4);
      expect(oysters.unitPrice).toBe(750n);
      expect(oysters.total).toBe(3000n);
    });

    it("reads the service charge", () => {
      expect(receipt.service).toBe(738n);
    });

    it("does not treat the percentage in the label as the amount", () => {
      expect(receipt.service).not.toBe(1250n);
    });
  });

  describe("four-figure amounts with apostrophe grouping", () => {
    const receipt = parse(LARGE_AMOUNTS);

    it("reads grouped thousands", () => {
      expect(receipt.items[0].total).toBe(126000n);
      expect(receipt.subtotal).toBe(174000n);
      expect(receipt.total).toBe(180612n);
    });
  });

  describe("a badly photographed receipt", () => {
    const receipt = parse(POORLY_DETECTED);

    it("does not throw, and invents nothing", () => {
      expect(receipt.total).toBeUndefined();
      expect(receipt.items.length).toBeGreaterThan(0);
    });

    it("reports the missing total rather than guessing one", () => {
      const issues = validateReceipt(receipt);
      expect(issues.map((issue) => issue.code)).toContain("noTotal");
    });

    it("reports low confidence", () => {
      expect(receipt.confidence ?? 0).toBeLessThan(0.5);
    });
  });

  describe("robustness", () => {
    it("returns an empty receipt for an image with no text", () => {
      const receipt = parseReceipt(
        { boxes: [], width: 100, height: 100 },
        { fallbackCurrency: "CHF" },
      );
      expect(receipt).toEqual({ items: [] });
    });

    it("reads the same receipt whether the detector split the columns or not", () => {
      // The detector's choice of box boundaries is not stable between photos;
      // the parse must not depend on it.
      const merged = parse([
        "Casa Italia",
        "13.08.2026",
        "Margherita 19.00",
        "Carbonara 24.50",
        "TOTAL CHF 43.50",
      ]);
      const split = parse([
        "Casa Italia",
        "13.08.2026",
        ["Margherita", "19.00"],
        ["Carbonara", "24.50"],
        ["TOTAL CHF", "43.50"],
      ]);

      expect(merged.items).toEqual(split.items);
      expect(merged.total).toBe(split.total);
      expect(merged.merchant).toBe(split.merchant);
    });

    it("keeps the fallback currency out of the parsed result", () => {
      // A receipt that names no currency must not claim one: the expense form
      // keeps the group's currency instead.
      const receipt = parse(["Cafe Central", "Espresso 3.50", "Total 3.50"]);
      expect(receipt.currency).toBeUndefined();
      expect(receipt.total).toBe(350n);
    });
  });
});
