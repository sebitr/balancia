import { describe, expect, it } from "vitest";
import { allocationForGroup, moneyForGroup } from "./display";

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
});

describe("allocationForGroup", () => {
  const allocation = { amount: 6500n, convertedAmount: 5655n };

  it("uses the frozen converted allocation in converted mode", () => {
    expect(allocationForGroup(allocation, "converted")).toBe(5655n);
  });

  it("keeps the original allocation in separate mode", () => {
    expect(allocationForGroup(allocation, "separate")).toBe(6500n);
  });
});
