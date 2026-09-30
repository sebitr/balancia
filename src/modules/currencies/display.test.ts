import { describe, expect, it } from "vitest";
import { allocationForGroup, ledgerCurrencyOf, moneyForGroup } from "./display";

describe("moneyForGroup", () => {
  const foreign = {
    amount: 13000n,
    currency: "EUR",
    convertedAmount: 11310n,
    convertedCurrency: "CHF",
  };

  it("uses the frozen converted amount and currency in converted mode", () => {
    expect(
      moneyForGroup(foreign, { mode: "converted", baseCurrency: "CHF" }),
    ).toEqual({ amount: 11310n, currency: "CHF" });
  });

  it("keeps the original money in separate mode", () => {
    expect(
      moneyForGroup(foreign, { mode: "separate", baseCurrency: null }),
    ).toEqual({ amount: 13000n, currency: "EUR" });
  });

  it("uses the base currency for an entry that needed no conversion", () => {
    expect(
      moneyForGroup(
        {
          amount: 92000n,
          currency: "CHF",
          convertedAmount: null,
          convertedCurrency: null,
        },
        { mode: "converted", baseCurrency: "CHF" },
      ),
    ).toEqual({ amount: 92000n, currency: "CHF" });
  });

  // An imported Splitwise row, or a restored backup: foreign, and no rate. Its
  // amount is yen, and labelling it with the base would read 30 000 yen as
  // 30 000 euros.
  it("keeps a foreign entry that carries no conversion in its own currency", () => {
    expect(
      moneyForGroup(
        {
          amount: 30000n,
          currency: "JPY",
          convertedAmount: null,
          convertedCurrency: null,
        },
        { mode: "converted", baseCurrency: "EUR" },
      ),
    ).toEqual({ amount: 30000n, currency: "JPY" });
  });
});

describe("ledgerCurrencyOf", () => {
  it("books a converted entry in the currency it was converted into", () => {
    expect(
      ledgerCurrencyOf(
        { currency: "JPY", convertedCurrency: "EUR" },
        "converted",
      ),
    ).toBe("EUR");
  });

  it("books a base-currency entry in the base", () => {
    expect(
      ledgerCurrencyOf(
        { currency: "EUR", convertedCurrency: null },
        "converted",
      ),
    ).toBe("EUR");
  });

  it("books a foreign entry with no rate in its own currency", () => {
    expect(
      ledgerCurrencyOf(
        { currency: "JPY", convertedCurrency: null },
        "converted",
      ),
    ).toBe("JPY");
  });

  it("books everything in its own currency in a separate group", () => {
    expect(
      ledgerCurrencyOf(
        { currency: "JPY", convertedCurrency: "EUR" },
        "separate",
      ),
    ).toBe("JPY");
  });
});

describe("allocationForGroup", () => {
  const allocation = { amount: 6500n, convertedAmount: 5655n };

  it("uses the frozen converted allocation in converted mode", () => {
    expect(allocationForGroup(allocation, "converted")).toBe(5655n);
  });

  it("keeps the original allocation in separate mode", () => {
    expect(allocationForGroup(allocation, "separate")).toBe(6500n);
  });

  it("keeps the original allocation of an entry that was never converted", () => {
    expect(
      allocationForGroup(
        { amount: 15000n, convertedAmount: null },
        "converted",
      ),
    ).toBe(15000n);
  });
});
