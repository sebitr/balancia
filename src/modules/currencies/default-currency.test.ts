import { describe, expect, it } from "vitest";

import {
  defaultCurrency,
  FALLBACK_CURRENCY,
  mostUsedCurrency,
} from "./default-currency";

describe("mostUsedCurrency", () => {
  it("is null for a group with no entries", () => {
    expect(mostUsedCurrency([])).toBeNull();
  });

  it("picks the heaviest", () => {
    expect(
      mostUsedCurrency([
        { currency: "EUR", weight: 400n },
        { currency: "CHF", weight: 96084n },
        { currency: "USD", weight: 900n },
      ]),
    ).toBe("CHF");
  });

  it("keeps the first when a settled group weighs everything at zero", () => {
    expect(
      mostUsedCurrency([
        { currency: "CHF", weight: 0n },
        { currency: "EUR", weight: 0n },
      ]),
    ).toBe("CHF");
  });
});

describe("defaultCurrency", () => {
  it("never overrides the entry being edited", () => {
    expect(
      defaultCurrency({
        editing: "JPY",
        base: "CHF",
        used: [{ currency: "CHF", weight: 5n }],
        preferred: "EUR",
      }),
    ).toBe("JPY");
  });

  it("prefers the group's declared base over its habit", () => {
    expect(
      defaultCurrency({
        base: "USD",
        used: [{ currency: "CHF", weight: 96084n }],
        preferred: "EUR",
      }),
    ).toBe("USD");
  });

  /**
   * The Colocation Genève case, and the reason this module exists: a group in
   * separate-currency mode has no base, so before this the literal won and the
   * drawer opened on EUR under a hero quoting CHF.
   */
  it("falls back to what a base-less group actually spends in", () => {
    expect(
      defaultCurrency({
        base: null,
        used: [{ currency: "CHF", weight: 96084n }],
        preferred: null,
      }),
    ).toBe("CHF");
  });

  it("uses the account's preference for a group with no habit yet", () => {
    expect(defaultCurrency({ base: null, used: [], preferred: "PLN" })).toBe(
      "PLN",
    );
  });

  it("guesses only when every signal is empty", () => {
    expect(defaultCurrency({})).toBe(FALLBACK_CURRENCY);
    expect(defaultCurrency({ base: null, used: [], preferred: null })).toBe(
      FALLBACK_CURRENCY,
    );
  });
});
