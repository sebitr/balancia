import { describe, expect, it } from "vitest";
import {
  containsTokenRun,
  foldText,
  isIdentifyingPrefix,
  merchantKey,
  normalizeMerchant,
  tokenize,
} from "./normalize";

/**
 * Normalization is where every other rule gets its input, so these tests are
 * about what survives it: the merchant's identity, and nothing else.
 */

describe("foldText", () => {
  it("folds case, accents and whitespace", () => {
    expect(foldText("  Épicerie   BIO  ")).toBe("epicerie bio");
    expect(foldText("Crèche")).toBe("creche");
    expect(foldText("HÔTEL")).toBe("hotel");
  });
});

describe("tokenize", () => {
  it("splits on anything that is not a letter or a digit", () => {
    expect(tokenize("NETFLIX.COM")).toEqual(["netflix", "com"]);
    expect(tokenize("apple.com/bill")).toEqual(["apple", "com", "bill"]);
    expect(tokenize("H&M")).toEqual(["h", "m"]);
  });

  it("keeps whole words, so a rule cannot match half of one", () => {
    // "rent" must not match inside "rental".
    expect(containsTokenRun(tokenize("car rental"), tokenize("rent"))).toBe(
      false,
    );
    expect(containsTokenRun(tokenize("monthly rent"), tokenize("rent"))).toBe(
      true,
    );
  });
});

describe("normalizeMerchant", () => {
  it("keeps the original text untouched", () => {
    const result = normalizeMerchant("CB UBER BV 1234");
    expect(result.rawMerchant).toBe("CB UBER BV 1234");
  });

  it("strips card and payment prefixes", () => {
    expect(normalizeMerchant("CB UBER BV 1234").normalizedMerchant).toContain(
      "uber bv",
    );
    expect(normalizeMerchant("PAIEMENT CB CARREFOUR").normalizedMerchant).toBe(
      "carrefour",
    );
    expect(normalizeMerchant("VISA DEBIT IKEA").normalizedMerchant).toBe(
      "ikea",
    );
  });

  it("extracts the merchant behind a payment processor", () => {
    expect(normalizeMerchant("PAYPAL *SPOTIFY")).toMatchObject({
      normalizedMerchant: "spotify",
      processor: "paypal",
    });
    expect(normalizeMerchant("SQ *CAFE CENTRAL")).toMatchObject({
      normalizedMerchant: "cafe central",
      processor: "square",
    });
    expect(normalizeMerchant("SUMUP *BOULANGERIE DUPONT")).toMatchObject({
      normalizedMerchant: "boulangerie dupont",
      processor: "sumup",
    });
  });

  it("reports a processor with nothing behind it", () => {
    expect(normalizeMerchant("PAYPAL EUROPE")).toMatchObject({
      processorOnly: false,
    });
    expect(normalizeMerchant("PAYPAL")).toMatchObject({
      normalizedMerchant: "",
      processorOnly: true,
    });
  });

  it("removes structured noise but not meaningful digits", () => {
    expect(
      normalizeMerchant("SNCF 12/05/2024 AUTH 998812").normalizedMerchant,
    ).toBe("sncf");
    expect(normalizeMerchant("CARREFOUR XXXX1234").normalizedMerchant).toBe(
      "carrefour",
    );
    // "365" is part of the product's name, so it stays.
    expect(normalizeMerchant("MICROSOFT 365").normalizedMerchant).toBe(
      "microsoft 365",
    );
  });

  it("drops a trailing city, but never the whole name", () => {
    expect(normalizeMerchant("CARREFOUR MARKET PARIS").normalizedMerchant).toBe(
      "carrefour market",
    );
    expect(normalizeMerchant("APPLE STORE GENEVA").normalizedMerchant).toBe(
      "apple store",
    );
    expect(normalizeMerchant("GENEVE").normalizedMerchant).toBe("geneve");
  });
});

describe("isIdentifyingPrefix", () => {
  it("accepts a rule followed only by noise", () => {
    expect(isIdentifyingPrefix(tokenize("migros 1234"), ["migros"])).toBe(true);
    expect(isIdentifyingPrefix(tokenize("uber bv"), ["uber"])).toBe(true);
  });

  it("rejects a rule followed by real words", () => {
    // A person called Max, not the streaming service.
    expect(
      isIdentifyingPrefix(tokenize("max s birthday dinner"), ["max"]),
    ).toBe(false);
  });
});

describe("merchantKey", () => {
  it("collapses the same shop's different store numbers", () => {
    expect(merchantKey("migros 1234")).toBe(merchantKey("migros 5678"));
    expect(merchantKey("migros 1234")).toBe("migros");
  });

  it("keeps a name that is nothing but short tokens", () => {
    expect(merchantKey("sig")).toBe("sig");
    expect(merchantKey("edf")).toBe("edf");
  });
});
