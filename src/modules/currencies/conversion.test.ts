import { describe, expect, it } from "vitest";
import {
  CurrencyConfigurationError,
  balanceCurrencies,
  effectiveAmountFromStored,
  parseExchangeRate,
  resolveConversion,
} from "./conversion";
import { money } from "./money";

const capturedAt = new Date("2026-01-15T12:00:00.000Z");

describe("parseExchangeRate", () => {
  it("accepts positive decimal rates", () => {
    expect(parseExchangeRate("1.0854").toString()).toBe("1.0854");
    expect(parseExchangeRate("160").toString()).toBe("160");
  });

  it("rejects zero, negative and malformed rates", () => {
    for (const bad of ["0", "-1", "abc", "", "1e5", "1,5"]) {
      expect(() => parseExchangeRate(bad)).toThrow(CurrencyConfigurationError);
    }
  });

  it("rejects rates with excessive precision", () => {
    expect(() => parseExchangeRate("1.0000000000001")).toThrow(
      CurrencyConfigurationError,
    );
  });
});

describe("resolveConversion — separate mode", () => {
  it("leaves the amount untouched and freezes no rate", () => {
    const result = resolveConversion({
      mode: "separate",
      baseCurrency: null,
      amount: money(1000n, "EUR"),
    });
    expect(result.effective).toEqual(money(1000n, "EUR"));
    expect(result.frozenRate).toBeNull();
  });

  it("refuses an exchange rate — separate groups do not convert", () => {
    expect(() =>
      resolveConversion({
        mode: "separate",
        baseCurrency: null,
        amount: money(1000n, "USD"),
        rate: "1.1",
      }),
    ).toThrow(CurrencyConfigurationError);
  });
});

describe("resolveConversion — converted mode", () => {
  it("passes through an amount already in the base currency", () => {
    const result = resolveConversion({
      mode: "converted",
      baseCurrency: "EUR",
      amount: money(1000n, "EUR"),
    });
    expect(result.effective).toEqual(money(1000n, "EUR"));
    expect(result.frozenRate).toBeNull();
  });

  it("converts a foreign amount and freezes the rate with its source", () => {
    const result = resolveConversion({
      mode: "converted",
      baseCurrency: "EUR",
      amount: money(1100n, "USD"),
      rate: "0.92",
      source: "manual",
      capturedAt,
    });
    // 11.00 USD * 0.92 = 10.12 EUR
    expect(result.effective).toEqual(money(1012n, "EUR"));
    expect(result.original).toEqual(money(1100n, "USD"));
    expect(result.frozenRate).toEqual({
      fromCurrency: "USD",
      toCurrency: "EUR",
      rate: "0.92",
      source: "manual",
      capturedAt,
    });
  });

  it("converts across differing currency exponents", () => {
    const result = resolveConversion({
      mode: "converted",
      baseCurrency: "EUR",
      amount: money(16000n, "JPY"),
      rate: "0.00625",
      capturedAt,
    });
    // 16000 JPY * 0.00625 = 100.00 EUR
    expect(result.effective).toEqual(money(10000n, "EUR"));
  });

  it("requires a rate for foreign currencies", () => {
    expect(() =>
      resolveConversion({
        mode: "converted",
        baseCurrency: "EUR",
        amount: money(1000n, "USD"),
      }),
    ).toThrow(CurrencyConfigurationError);
  });

  it("requires a base currency", () => {
    expect(() =>
      resolveConversion({
        mode: "converted",
        baseCurrency: null,
        amount: money(1000n, "USD"),
        rate: "0.92",
      }),
    ).toThrow(CurrencyConfigurationError);
  });

  it("rejects a non-unity rate for a base-currency amount", () => {
    expect(() =>
      resolveConversion({
        mode: "converted",
        baseCurrency: "EUR",
        amount: money(1000n, "EUR"),
        rate: "1.5",
      }),
    ).toThrow(CurrencyConfigurationError);
  });
});

describe("effectiveAmountFromStored", () => {
  it("returns the original amount in separate mode", () => {
    expect(
      effectiveAmountFromStored({
        mode: "separate",
        baseCurrency: null,
        originalAmount: 1000n,
        originalCurrency: "USD",
        convertedAmount: null,
      }),
    ).toEqual(money(1000n, "USD"));
  });

  it("returns the stored converted amount rather than recomputing it", () => {
    expect(
      effectiveAmountFromStored({
        mode: "converted",
        baseCurrency: "EUR",
        originalAmount: 1100n,
        originalCurrency: "USD",
        convertedAmount: 1012n,
      }),
    ).toEqual(money(1012n, "EUR"));
  });

  it("fails loudly when a converted amount is missing", () => {
    expect(() =>
      effectiveAmountFromStored({
        mode: "converted",
        baseCurrency: "EUR",
        originalAmount: 1100n,
        originalCurrency: "USD",
        convertedAmount: null,
      }),
    ).toThrow(CurrencyConfigurationError);
  });
});

describe("balanceCurrencies", () => {
  it("returns only the base currency in converted mode", () => {
    expect(
      balanceCurrencies({
        mode: "converted",
        baseCurrency: "EUR",
        usedCurrencies: ["USD", "JPY", "EUR"],
      }),
    ).toEqual(["EUR"]);
  });

  it("returns every used currency, sorted, in separate mode", () => {
    expect(
      balanceCurrencies({
        mode: "separate",
        baseCurrency: null,
        usedCurrencies: ["USD", "JPY", "EUR", "USD"],
      }),
    ).toEqual(["EUR", "JPY", "USD"]);
  });
});
