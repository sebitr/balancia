import { describe, expect, it } from "vitest";
import { classifyLabel, detectCurrency, foldLabel } from "./labels";

describe("foldLabel", () => {
  it("folds case and accents", () => {
    expect(foldLabel("MwSt.")).toBe("mwst");
    expect(foldLabel("Sous-total")).toBe("sous total");
    expect(foldLabel("TOTALE")).toBe("totale");
  });
});

describe("classifyLabel", () => {
  it("recognizes totals in several languages", () => {
    for (const label of [
      "TOTAL",
      "Totale",
      "Gesamtbetrag",
      "Montant total",
      "Total a payer",
      "Importe total",
      "Te betalen",
    ]) {
      expect(classifyLabel(label), label).toBe("total");
    }
  });

  it("recognizes subtotals, and never reads one as a total", () => {
    // Every word for "subtotal" contains a word for "total"; getting this
    // wrong reads the subtotal as the bill and undercharges the table.
    for (const label of [
      "Subtotal",
      "Sous-total",
      "Zwischensumme",
      "Totale parziale",
      "Subtotaal",
      "Net total",
    ]) {
      expect(classifyLabel(label), label).toBe("subtotal");
    }
  });

  it("recognizes tax in several languages", () => {
    for (const label of [
      "TVA 10%",
      "MwSt 7.7%",
      "IVA 22%",
      "VAT",
      "BTW",
      "Sales Tax",
    ]) {
      expect(classifyLabel(label), label).toBe("tax");
    }
  });

  it("recognizes tips and service charges", () => {
    expect(classifyLabel("Tip")).toBe("tip");
    expect(classifyLabel("Trinkgeld")).toBe("tip");
    expect(classifyLabel("Pourboire")).toBe("tip");
    expect(classifyLabel("Service charge 12.5%")).toBe("service");
    expect(classifyLabel("Coperto")).toBe("service");
  });

  it("recognizes payment lines as noise, not as the total", () => {
    // These carry an amount, and it is not the bill.
    for (const label of ["Cash", "Change", "Visa", "Rueckgeld", "Especes"]) {
      expect(classifyLabel(label), label).toBe("noise");
    }
  });

  it("leaves ordinary item lines unclassified", () => {
    for (const label of [
      "Margherita",
      "Carbonara",
      "Cafe gourmand",
      "Bruschetta",
    ]) {
      expect(classifyLabel(label), label).toBeNull();
    }
  });

  it("does not mistake a dish for a label", () => {
    // `Table d'hôte` and `Service de table` would both be lost to an
    // over-eager noise list.
    expect(classifyLabel("Entrecote")).toBeNull();
    expect(classifyLabel("Salade de chevre")).toBeNull();
  });
});

describe("detectCurrency", () => {
  it("reads codes and symbols", () => {
    expect(detectCurrency("TOTAL CHF 72.10")).toBe("CHF");
    expect(detectCurrency("Gesamtbetrag EUR 46,65")).toBe("EUR");
    expect(detectCurrency("Total € 46,65")).toBe("EUR");
    expect(detectCurrency("Total £12.00")).toBe("GBP");
    expect(detectCurrency("TOTAL $45.71")).toBe("USD");
  });

  it("prefers the more specific mark", () => {
    // A receipt naming both must not come back as dollars.
    expect(detectCurrency("Total R$ 45,71")).toBe("BRL");
    expect(detectCurrency("Total US$ 45.71")).toBe("USD");
  });

  it("returns null when the receipt names no currency", () => {
    // The group's currency is then kept; nothing is assumed.
    expect(detectCurrency("Margherita 19.00")).toBeNull();
    expect(detectCurrency("TOTAL 72.10")).toBeNull();
  });
});
