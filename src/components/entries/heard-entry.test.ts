import { describe, expect, it } from "vitest";
import { heardEntry } from "./heard-entry";

/**
 * Turning a spoken sentence into three fields.
 *
 * The failure that matters is not "it heard the wrong shop" — the reader sees
 * and fixes that. It is a sentence that produces a *number* nobody said, or
 * loses the words that say what the money was for.
 */

describe("what it hears", () => {
  it("takes the brief's own example", () => {
    expect(heardEntry("add 24 francs Coop")).toEqual({
      amountText: "24",
      currency: "CHF",
      description: "Coop",
    });
  });

  it("reads decimals said either way", () => {
    expect(heardEntry("12.50 euros bakery").amountText).toBe("12.50");
    expect(heardEntry("12,50 euros bakery").amountText).toBe("12.50");
  });

  it("keeps the description when there is no amount", () => {
    expect(heardEntry("coffee with Hervé")).toEqual({
      amountText: "",
      currency: "",
      description: "coffee with Hervé",
    });
  });

  it("keeps the amount when there is nothing else", () => {
    expect(heardEntry("42")).toEqual({
      amountText: "42",
      currency: "",
      description: "",
    });
  });

  it("says nothing about an empty sentence", () => {
    expect(heardEntry("   ")).toEqual({
      amountText: "",
      currency: "",
      description: "",
    });
  });
});

describe("the currency", () => {
  it("understands the words people say", () => {
    expect(heardEntry("8 balles café").currency).toBe("CHF");
    expect(heardEntry("8 quid lunch").currency).toBe("GBP");
    expect(heardEntry("8 bucks lunch").currency).toBe("USD");
  });

  it("understands a code a recogniser wrote out", () => {
    expect(heardEntry("30 EUR train").currency).toBe("EUR");
  });

  it("falls back to the group's rather than to none", () => {
    // A sentence with no currency in it does not mean "no currency".
    expect(heardEntry("30 train", "CHF").currency).toBe("CHF");
    expect(heardEntry("30 euros train", "CHF").currency).toBe("EUR");
  });

  it("takes the currency word out of the description", () => {
    expect(heardEntry("24 francs Coop Genève").description).toBe("Coop Genève");
  });

  it("leaves a three-letter word that is not a currency alone", () => {
    expect(heardEntry("12 cat food")).toEqual({
      amountText: "12",
      currency: "",
      description: "cat food",
    });
  });
});

describe("the words around it", () => {
  it("drops the scaffolding at the front", () => {
    expect(heardEntry("add 24 francs Coop").description).toBe("Coop");
    // Only from the front, and only while it keeps finding them: "une" is not
    // scaffolding, so the stripping stops there and the rest is kept as said.
    expect(heardEntry("ajoute une dépense de 24 francs Coop").description).toBe(
      "une dépense de Coop",
    );
  });

  it("keeps a scaffolding word that is doing real work", () => {
    // "note" only introduces an entry at the front of a sentence.
    expect(heardEntry("12 francs note book").description).toBe("note book");
  });

  it("finds no amount at all in a long run of digits", () => {
    // A phone number is not an amount, and picking eight digits out of the
    // middle of one would put a figure in the field that nobody said.
    expect(heardEntry("call 0041791234567").amountText).toBe("");
    expect(heardEntry("call 0041791234567").description).toBe(
      "call 0041791234567",
    );
  });
});
