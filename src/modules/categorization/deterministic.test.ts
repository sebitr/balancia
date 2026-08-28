import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "./confidence";
import { detectSubcategory, prepareText } from "./deterministic";
import { singularize, tokenize } from "./normalize";
import { SUBCATEGORY_SEEDS } from "./seeds";
import { isValidSubcategory } from "./taxonomy";

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

/**
 * The subcategory rules, as data.
 *
 * Coverage is intentionally partial — most categories name only a handful of
 * their children, and that is a supported outcome. What must hold is that
 * every rule that exists points somewhere real.
 */
describe("subcategory seeds", () => {
  it("only ever names a subcategory of the category it sits under", () => {
    for (const [category, rules] of Object.entries(SUBCATEGORY_SEEDS)) {
      for (const rule of rules) {
        expect(isValidSubcategory(category, rule.id)).toBe(true);
      }
    }
  });

  it("names each subcategory at most once per category", () => {
    for (const [category, rules] of Object.entries(SUBCATEGORY_SEEDS)) {
      const ids = rules.map((rule) => rule.id);
      expect(new Set(ids).size, `${category} repeats a subcategory`).toBe(
        ids.length,
      );
    }
  });

  it("never gives two siblings the same word", () => {
    // `detectSubcategory` keeps the *first* rule to reach the best score, so
    // two siblings carrying one word would be settled by which was written
    // first — an ordering nobody chose and no reader can see. A word that
    // would have to sit under both is written under neither.
    for (const [category, rules] of Object.entries(SUBCATEGORY_SEEDS)) {
      const owner = new Map<string, string>();
      for (const rule of rules) {
        const values = [
          ...(rule.merchants ?? []),
          ...Object.values(rule.phrases ?? {}).flat(),
        ];
        for (const value of values) {
          const key = tokenize(value).map(singularize).join(" ");
          expect(
            owner.get(key) ?? rule.id,
            `${category}: "${value}" sits under two subcategories`,
          ).toBe(rule.id);
          owner.set(key, rule.id);
        }
      }
    }
  });

  it("carries evidence on every rule", () => {
    // A rule with neither a merchant nor a phrase can never fire, and would
    // read as coverage that is not there.
    for (const rules of Object.values(SUBCATEGORY_SEEDS)) {
      for (const rule of rules) {
        const merchants = rule.merchants?.length ?? 0;
        const phrases = Object.values(rule.phrases ?? {}).flat().length;
        expect(merchants + phrases).toBeGreaterThan(0);
      }
    }
  });

  it("scores nothing for a category that has no rules", () => {
    expect(
      detectSubcategory("other", prepareText({ merchant: "Shell" })),
    ).toBeNull();
  });

  it("only ever scores at merchant or phrase strength", () => {
    // There is no weak-keyword tier here: `subcategoryMinScore` is set so that
    // nothing below "this brand sells exactly this" can fill the field.
    const detected = detectSubcategory(
      "transport",
      prepareText({ merchant: "Shell", description: "Shell" }),
    );
    expect(detected?.confidence).toBeGreaterThanOrEqual(
      THRESHOLDS.subcategoryMinScore,
    );
  });
});
