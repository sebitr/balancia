import { describe, expect, it } from "vitest";
import { compareDebts, sumByCurrency } from "./debts";

/**
 * The one rule these helpers exist to keep: currencies are added up separately
 * or not at all. A group that spent in euros and yen owes two figures, and any
 * single number standing for both would be one nobody can pay.
 */
describe("totalling debts", () => {
  it("adds up amounts in the same currency", () => {
    expect(
      sumByCurrency([
        { amount: "14800", currency: "EUR" },
        { amount: "10000", currency: "EUR" },
      ]),
    ).toEqual([{ amount: "24800", currency: "EUR" }]);
  });

  it("keeps currencies apart", () => {
    expect(
      sumByCurrency([
        { amount: "1400", currency: "JPY" },
        { amount: "14800", currency: "EUR" },
        { amount: "600", currency: "JPY" },
      ]),
    ).toEqual([
      { amount: "14800", currency: "EUR" },
      { amount: "2000", currency: "JPY" },
    ]);
  });

  it("handles amounts far past what a number could hold", () => {
    expect(
      sumByCurrency([
        { amount: "9007199254740993", currency: "EUR" },
        { amount: "1", currency: "EUR" },
      ]),
    ).toEqual([{ amount: "9007199254740994", currency: "EUR" }]);
  });

  it("has nothing to say about nothing", () => {
    expect(sumByCurrency([])).toEqual([]);
  });
});

describe("ordering debts", () => {
  it("puts the larger amount first", () => {
    expect(
      [
        { amount: "1000", currency: "EUR" },
        { amount: "5000", currency: "EUR" },
      ].sort(compareDebts),
    ).toEqual([
      { amount: "5000", currency: "EUR" },
      { amount: "1000", currency: "EUR" },
    ]);
  });

  /**
   * Two equal counts of minor units in different currencies are not equal
   * money, and no rate is applied here to find out which is bigger. The tie is
   * broken by code purely so the order cannot wobble between renders.
   */
  it("settles a tie by currency code rather than leaving it to chance", () => {
    expect(
      [
        { amount: "1400", currency: "JPY" },
        { amount: "1400", currency: "EUR" },
      ].sort(compareDebts),
    ).toEqual([
      { amount: "1400", currency: "EUR" },
      { amount: "1400", currency: "JPY" },
    ]);
  });
});
