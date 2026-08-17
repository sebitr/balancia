import { describe, expect, it } from "vitest";
import {
  MAX_FAVORITE_CURRENCIES,
  sanitiseFavoriteCurrencies,
  seedFavoriteCurrencies,
  toggleFavoriteCurrency,
} from "./favorites";

describe("sanitising a favourites list", () => {
  it("keeps known codes in the order they were given", () => {
    expect(sanitiseFavoriteCurrencies(["THB", "CHF", "EUR"])).toEqual([
      "THB",
      "CHF",
      "EUR",
    ]);
  });

  it("drops anything that is not a currency this app knows", () => {
    expect(
      sanitiseFavoriteCurrencies(["CHF", "XXX", "", "  ", 7, null, {}]),
    ).toEqual(["CHF"]);
  });

  it("normalises what a client sends and refuses duplicates", () => {
    expect(sanitiseFavoriteCurrencies([" chf ", "CHF", "Chf"])).toEqual([
      "CHF",
    ]);
  });

  /** The bound the column also enforces: nothing writes an unbounded list. */
  it("caps the list", () => {
    const many: string[] = Array.from({ length: 40 }, (_, index) =>
      index % 2 === 0 ? "CHF" : "EUR",
    );
    many.push("USD", "GBP", "JPY", "THB", "SEK", "NOK", "DKK", "PLN", "CZK");
    expect(sanitiseFavoriteCurrencies(many).length).toBeLessThanOrEqual(
      MAX_FAVORITE_CURRENCIES,
    );
  });
});

describe("toggling one", () => {
  it("adds at the end, so the reader's own order survives", () => {
    expect(toggleFavoriteCurrency(["CHF", "EUR"], "THB")).toEqual([
      "CHF",
      "EUR",
      "THB",
    ]);
  });

  it("removes one that is already there", () => {
    expect(toggleFavoriteCurrency(["CHF", "EUR", "THB"], "EUR")).toEqual([
      "CHF",
      "THB",
    ]);
  });

  /**
   * A star that visibly does nothing is a bug to whoever pressed it, so at the
   * cap the oldest favourite makes room rather than the new one being refused.
   */
  it("makes room at the cap rather than refusing the new one", () => {
    const full = [
      "AED",
      "AUD",
      "BRL",
      "CAD",
      "CHF",
      "CNY",
      "CZK",
      "DKK",
      "EUR",
      "GBP",
      "HUF",
      "IDR",
    ];
    expect(full).toHaveLength(MAX_FAVORITE_CURRENCIES);

    const next = toggleFavoriteCurrency(full, "THB");
    expect(next).toHaveLength(MAX_FAVORITE_CURRENCIES);
    expect(next.at(-1)).toBe("THB");
    expect(next).not.toContain("AED");
  });
});

describe("seeding a list nobody has built yet", () => {
  it("starts from what the reader already has", () => {
    expect(seedFavoriteCurrencies("CHF")).toEqual(["CHF"]);
  });

  it("stays empty when there is nothing to seed it with", () => {
    // The picker then shows no favourites section at all, which is the design's
    // own answer — better than three guesses about where somebody lives.
    expect(seedFavoriteCurrencies(null, undefined)).toEqual([]);
  });
});
