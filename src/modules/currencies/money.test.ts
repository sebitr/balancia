import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import fc from "fast-check";
import {
  CurrencyMismatchError,
  InvalidAmountError,
  MAX_MINOR_UNITS,
  addMoney,
  convertMoney,
  deserializeMoney,
  formatMoney,
  money,
  parseMajorAmount,
  serializeMoney,
  subtractMoney,
  sumMoney,
  toMajorString,
} from "./money";
import { UnknownCurrencyError, currencyExponent } from "./iso-4217";

describe("currency metadata", () => {
  it("knows two-decimal, zero-decimal and three-decimal currencies", () => {
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KRW")).toBe(0);
    expect(currencyExponent("BHD")).toBe(3);
    expect(currencyExponent("KWD")).toBe(3);
    expect(currencyExponent("TND")).toBe(3);
  });

  it("rejects unknown codes rather than guessing an exponent", () => {
    expect(() => currencyExponent("XYZ")).toThrow(UnknownCurrencyError);
    expect(() => money(100n, "NOPE")).toThrow(UnknownCurrencyError);
  });
});

describe("parseMajorAmount", () => {
  it("parses two-decimal currencies", () => {
    expect(parseMajorAmount("10.50", "EUR").amount).toBe(1050n);
    expect(parseMajorAmount("0.01", "EUR").amount).toBe(1n);
    expect(parseMajorAmount("10", "EUR").amount).toBe(1000n);
    expect(parseMajorAmount("-3.25", "EUR").amount).toBe(-325n);
  });

  it("parses zero-decimal currencies without inventing minor units", () => {
    expect(parseMajorAmount("1050", "JPY").amount).toBe(1050n);
    expect(parseMajorAmount("0", "JPY").amount).toBe(0n);
  });

  it("parses three-decimal currencies", () => {
    expect(parseMajorAmount("1.005", "BHD").amount).toBe(1005n);
    expect(parseMajorAmount("1.5", "BHD").amount).toBe(1500n);
  });

  it("rejects more precision than the currency supports", () => {
    expect(() => parseMajorAmount("10.505", "EUR")).toThrow(InvalidAmountError);
    expect(() => parseMajorAmount("10.5", "JPY")).toThrow(InvalidAmountError);
    expect(() => parseMajorAmount("1.0005", "BHD")).toThrow(InvalidAmountError);
  });

  it("rejects non-numeric input", () => {
    for (const bad of ["", "abc", "1,50", "1.2.3", "1e5", " ", "--1"]) {
      expect(() => parseMajorAmount(bad, "EUR")).toThrow(InvalidAmountError);
    }
  });

  it("round-trips through toMajorString for every supported precision", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.constantFrom("EUR", "JPY", "BHD", "USD", "KWD", "ISK"),
        (amount, currency) => {
          const value = money(amount, currency);
          const text = toMajorString(value);
          expect(parseMajorAmount(text, currency).amount).toBe(amount);
        },
      ),
    );
  });
});

describe("toMajorString", () => {
  it("pads fractional digits", () => {
    expect(toMajorString(money(5n, "EUR"))).toBe("0.05");
    expect(toMajorString(money(-5n, "EUR"))).toBe("-0.05");
    expect(toMajorString(money(1050n, "JPY"))).toBe("1050");
    expect(toMajorString(money(1005n, "BHD"))).toBe("1.005");
    expect(toMajorString(money(0n, "EUR"))).toBe("0.00");
  });
});

describe("arithmetic", () => {
  it("adds and subtracts within a currency", () => {
    expect(addMoney(money(100n, "EUR"), money(250n, "EUR")).amount).toBe(350n);
    expect(subtractMoney(money(100n, "EUR"), money(250n, "EUR")).amount).toBe(
      -150n,
    );
  });

  it("refuses to mix currencies", () => {
    expect(() => addMoney(money(1n, "EUR"), money(1n, "USD"))).toThrow(
      CurrencyMismatchError,
    );
    expect(() => sumMoney([money(1n, "USD")], "EUR")).toThrow(
      CurrencyMismatchError,
    );
  });

  it("stays exact well beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = money(9_007_199_254_740_993n, "EUR");
    expect(addMoney(huge, money(1n, "EUR")).amount).toBe(
      9_007_199_254_740_994n,
    );
  });
});

describe("serialization", () => {
  it("round-trips as strings so JSON never sees a bigint", () => {
    const value = money(9_007_199_254_740_993n, "EUR");
    const serialized = serializeMoney(value);
    expect(serialized.amount).toBe("9007199254740993");
    expect(JSON.parse(JSON.stringify(serialized)).amount).toBe(
      "9007199254740993",
    );
    expect(deserializeMoney(serialized)).toEqual(value);
  });

  it("rejects malformed serialized amounts", () => {
    expect(() => deserializeMoney({ amount: "10.5", currency: "EUR" })).toThrow(
      InvalidAmountError,
    );
  });
});

describe("convertMoney", () => {
  it("converts between two-decimal currencies with half-even rounding", () => {
    // 1 EUR = 1.1 USD
    expect(convertMoney(money(1000n, "EUR"), "USD", "1.1").amount).toBe(1100n);
    // 0.005 rounds to even
    expect(convertMoney(money(1n, "EUR"), "USD", "1.5").amount).toBe(2n);
    expect(convertMoney(money(3n, "EUR"), "USD", "1.5").amount).toBe(4n);
  });

  it("handles exponent differences (EUR -> JPY)", () => {
    // 1 EUR = 160 JPY; 10.00 EUR = 1600 JPY (exponent 2 -> 0)
    expect(convertMoney(money(1000n, "EUR"), "JPY", "160").amount).toBe(1600n);
  });

  it("handles exponent differences (JPY -> EUR)", () => {
    // 1 JPY = 0.00625 EUR; 1600 JPY = 10.00 EUR
    expect(convertMoney(money(1600n, "JPY"), "EUR", "0.00625").amount).toBe(
      1000n,
    );
  });

  it("handles three-decimal targets", () => {
    // 1 EUR = 0.42 KWD; 100.00 EUR = 42.000 KWD
    expect(convertMoney(money(10000n, "EUR"), "KWD", "0.42").amount).toBe(
      42000n,
    );
  });

  it("is deterministic — repeating a conversion never drifts", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.integer({ min: 1, max: 5_000_000 }),
        (amount, rateMillionths) => {
          const rate = new Decimal(rateMillionths).dividedBy(1_000_000);
          const first = convertMoney(money(amount, "EUR"), "USD", rate);
          const second = convertMoney(money(amount, "EUR"), "USD", rate);
          expect(first.amount).toBe(second.amount);
        },
      ),
    );
  });

  it("rejects non-positive rates", () => {
    expect(() => convertMoney(money(100n, "EUR"), "USD", "0")).toThrow(
      InvalidAmountError,
    );
    expect(() => convertMoney(money(100n, "EUR"), "USD", "-1")).toThrow(
      InvalidAmountError,
    );
  });
});

/**
 * A conversion worked in whole numbers: the amount times the rate's digits,
 * shifted for the two exponents, and rounded half-even exactly once. What
 * `convertMoney` has to agree with, digit for digit.
 */
function exactConversion(amount: bigint, rate: string, shift: number): bigint {
  const [whole, fraction = ""] = rate.split(".");
  let numerator = (amount < 0n ? -amount : amount) * BigInt(whole + fraction);
  let denominator = 10n ** BigInt(fraction.length);
  if (shift >= 0) numerator *= 10n ** BigInt(shift);
  else denominator *= 10n ** BigInt(-shift);
  const quotient = numerator / denominator;
  const twice = (numerator % denominator) * 2n;
  const rounded =
    twice > denominator || (twice === denominator && quotient % 2n === 1n)
      ? quotient + 1n
      : quotient;
  return amount < 0n ? -rounded : rounded;
}

describe("convertMoney at the accepted bounds (property-based)", () => {
  // Any rate `parseExchangeRate` lets through: up to a billion, twelve places.
  const rateArbitrary = fc
    .tuple(
      fc.integer({ min: 0, max: 999_999_999 }),
      fc.bigInt({ min: 0n, max: 10n ** 12n - 1n }),
    )
    .filter(([whole, fraction]) => whole > 0 || fraction > 0n)
    .map(
      ([whole, fraction]) =>
        `${whole}.${fraction.toString().padStart(12, "0")}`,
    );

  it("rounds once, whatever the size of the amount and the rate", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -MAX_MINOR_UNITS, max: MAX_MINOR_UNITS }),
        rateArbitrary,
        fc.constantFrom(
          ["EUR", "USD"] as const,
          ["EUR", "JPY"] as const,
          ["JPY", "KWD"] as const,
        ),
        (amount, rate, [from, to]) => {
          const shift = currencyExponent(to) - currencyExponent(from);
          expect(convertMoney(money(amount, from), to, rate).amount).toBe(
            exactConversion(amount, rate, shift),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it("does not round the product before the rounding it documents", () => {
    // Found at decimal.js's default twenty digits: the product was cut to
    // twenty places first, and the one rounding that followed came out a
    // cent short.
    expect(
      convertMoney(money(31508292346484045n, "EUR"), "USD", "3.424951230535")
        .amount,
    ).toBe(107914364644147053n);
  });
});

describe("formatMoney", () => {
  it("formats with the right number of decimals per currency", () => {
    expect(formatMoney(money(1050n, "EUR"), { locale: "en-US" })).toContain(
      "10.50",
    );
    expect(formatMoney(money(1050n, "JPY"), { locale: "en-US" })).toContain(
      "1,050",
    );
    expect(formatMoney(money(1005n, "BHD"), { locale: "en-US" })).toContain(
      "1.005",
    );
  });

  it("formats large amounts without float precision loss", () => {
    const formatted = formatMoney(money(1234567890123456789n, "USD"), {
      locale: "en-US",
    });
    expect(formatted).toContain("12,345,678,901,234,567.89");
  });

  it("can render a bare number for tabular layouts", () => {
    expect(
      formatMoney(money(-1050n, "EUR"), { locale: "en-US", display: "none" }),
    ).toBe("-10.50");
  });

  it("rounds to whole units when asked for no decimals", () => {
    expect(
      formatMoney(money(2533331n, "CHF"), {
        locale: "en-US",
        fractionDigits: 0,
      }),
    ).toContain("25,333");
    // Rounded for the reader, not truncated: the centimes still carry.
    expect(
      formatMoney(money(1060n, "EUR"), { locale: "en-US", fractionDigits: 0 }),
    ).toContain("11");
  });
});
