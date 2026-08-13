import { describe, expect, it } from "vitest";
import { prepareText } from "./deterministic";

/**
 * What the classifier is allowed to read, and in what shape.
 *
 * Two different texts come out of one transaction, and the difference is the
 * point: matching wants everything folded flat, the sentence model wants the
 * words as they were written.
 */

describe("prepareText", () => {
  it("keeps accents and case for the model, and folds them for matching", () => {
    const prepared = prepareText({ description: "Dîner chez Léa" });
    expect(prepared.semanticText).toBe("Dîner chez Léa");
    expect(prepared.textTokens).toContain("diner");
  });

  it("joins the fields that describe the purchase", () => {
    const prepared = prepareText({
      description: "COOP PRONTO",
      note: "on the way back",
      receipt: { merchant: "Coop Pronto", itemNames: ["diesel", "unleaded"] },
    });
    expect(prepared.semanticText).toBe(
      "COOP PRONTO | on the way back | Coop Pronto | diesel unleaded",
    );
  });

  it("removes identifiers before anything sees them", () => {
    const prepared = prepareText({
      description: "NETFLIX.COM 12/05/2024",
      note: "ref 550e8400-e29b-41d4-a716-446655440000 auth 998812",
    });
    expect(prepared.semanticText).toBe("NETFLIX.COM");
    expect(prepared.semanticText).not.toMatch(/\d{6}/);
  });

  it("takes the merchant from the description when there is no merchant", () => {
    const prepared = prepareText({ description: "CB MIGROS 1234" });
    expect(prepared.normalizedMerchant).toBe("migros 1234");
    expect(prepared.rawMerchant).toBe("CB MIGROS 1234");
  });

  it("prefers an explicit merchant over the description", () => {
    const prepared = prepareText({
      merchant: "CARREFOUR MARKET",
      description: "weekly shop",
    });
    expect(prepared.normalizedMerchant).toBe("carrefour market");
    // The description is still evidence, just not the merchant.
    expect(prepared.textTokens).toContain("shop");
  });

  it("reports the processor and what was behind it", () => {
    expect(prepareText({ description: "PAYPAL *SPOTIFY" })).toMatchObject({
      processor: "paypal",
      normalizedMerchant: "spotify",
      processorOnly: false,
    });
    expect(prepareText({ description: "PAYPAL" })).toMatchObject({
      processor: "paypal",
      normalizedMerchant: "",
      processorOnly: true,
    });
  });

  it("has nothing to say about nothing", () => {
    const prepared = prepareText({});
    expect(prepared.semanticText).toBe("");
    expect(prepared.textTokens).toEqual([]);
  });
});
