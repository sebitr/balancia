import { describe, expect, it } from "vitest";
import {
  currencyCatalogue,
  currencyEntry,
  currencyFlag,
  normaliseForSearch,
  searchCurrencies,
} from "./catalog";
import { SUPPORTED_CURRENCIES } from "./iso-4217";

/**
 * The catalogue is derived rather than written down, which buys two languages
 * for free and costs a guarantee: `Intl` decides what most of it says. These
 * check the parts that are ours — that every currency comes out with a flag
 * and a name, that the exceptions `Intl` gets wrong are actually corrected,
 * and that search reaches a row by the things people type at it.
 *
 * Nothing here asserts an exact name. Those come from the runtime's ICU data
 * and change with it, and a test that pins "Swiss Franc" would fail on a
 * Node upgrade without anything being wrong.
 */

describe("the currency catalogue", () => {
  it("covers every supported currency, once", () => {
    const catalogue = currencyCatalogue("en");
    expect(catalogue).toHaveLength(SUPPORTED_CURRENCIES.length);
    expect(new Set(catalogue.map((entry) => entry.code)).size).toBe(
      catalogue.length,
    );
  });

  it("gives every row something to show", () => {
    for (const entry of currencyCatalogue("fr")) {
      expect(entry.flag, entry.code).not.toBe("");
      expect(entry.name, entry.code).not.toBe("");
      // The name is a standalone line, so it starts on a capital — which
      // French currency names out of `Intl` do not.
      expect(entry.name[0], entry.code).toBe(entry.name[0]?.toUpperCase());
    }
  });

  /**
   * The rule is "the first two letters are the country". These are the ones it
   * is wrong about, and a flag built from them is either a country that no
   * longer exists or two letters that never were one.
   */
  it("does not build a flag out of a region that is not one", () => {
    for (const code of ["XAF", "XOF", "XPF", "XCD", "XCG", "ANG"]) {
      const entry = currencyEntry(code, "en");
      expect(entry?.flag, code).not.toContain("🇽");
      expect(entry?.flag, code).not.toBe("🇦🇳");
    }
  });

  /**
   * The currency headings ask for a flag on its own, and would rather not
   * build a hundred and fifty-six rows of `Intl` to get one. Two ways of
   * answering the same question is one way for them to disagree.
   */
  it("hands out the same flag on its own as it does in a row", () => {
    for (const { code, flag } of currencyCatalogue("en")) {
      expect(currencyFlag(code), code).toBe(flag);
    }
  });

  it("says nothing where the symbol is only the code again", () => {
    // Fifty-odd currencies have no symbol of their own; the row already leads
    // with the code, so repeating it is worse than leaving the space empty.
    expect(currencyEntry("AED", "en")?.symbol).toBe("");
    expect(currencyEntry("EUR", "en")?.symbol).toBe("€");
  });
});

describe("searching it", () => {
  const catalogue = currencyCatalogue("fr");
  const codes = (query: string) =>
    searchCurrencies(catalogue, query).map((entry) => entry.code);

  it("matches the code", () => {
    expect(codes("chf")).toContain("CHF");
  });

  it("matches the country in the reader's own language", () => {
    expect(codes("suisse")).toContain("CHF");
    expect(codes("japan")).not.toContain("JPY");
    expect(currencyCatalogue("en")).toSatisfy(
      (entries: ReturnType<typeof currencyCatalogue>) =>
        searchCurrencies(entries, "japan").some(
          (entry) => entry.code === "JPY",
        ),
    );
  });

  /** Nobody reaches for the accent key to find a currency. */
  it("ignores accents and case on both sides", () => {
    expect(codes("etats")).toContain("USD");
    expect(codes("ÉTATS")).toContain("USD");
    expect(normaliseForSearch("Émirats")).toBe("emirats");
  });

  /** Where people go, which is not always what the country is called. */
  it("matches the place rather than the state", () => {
    expect(codes("bali")).toContain("IDR");
    expect(codes("dubai")).toContain("AED");
    expect(codes("tahiti")).toContain("XPF");
  });

  it("matches a member of a currency union, not only the union", () => {
    expect(codes("senegal")).toContain("XOF");
    expect(codes("portugal")).toContain("EUR");
  });

  it("returns the whole list for an empty query, and nothing for nonsense", () => {
    expect(codes("   ")).toHaveLength(catalogue.length);
    expect(codes("qqqqq")).toEqual([]);
  });
});
