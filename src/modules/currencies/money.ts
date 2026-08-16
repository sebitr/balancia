import Decimal from "decimal.js";
import { currencyExponent, getCurrency, minorUnitsPerMajor } from "./iso-4217";

/**
 * A monetary amount: an exact integer count of minor units plus its currency.
 *
 * Money never touches JavaScript `number`. Arithmetic is bigint; exchange-rate
 * multiplication goes through decimal.js and is rounded once, deterministically.
 * At JSON boundaries amounts travel as decimal strings of minor units
 * ("1050"), because JSON numbers cannot represent large bigints safely.
 */
export interface Money {
  /** Signed integer count of minor units. */
  readonly amount: bigint;
  /** ISO 4217 code, e.g. "EUR". */
  readonly currency: string;
}

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(`Cannot combine amounts in ${left} and ${right}`);
    this.name = "CurrencyMismatchError";
  }
}

/**
 * Why an amount was rejected. As with `AllocationError`, the message stays
 * English and developer-facing while `code` is what the UI translates.
 */
export type InvalidAmountCode = "internal" | "notDecimal" | "tooPrecise";

export class InvalidAmountError extends Error {
  readonly code: InvalidAmountCode;
  readonly params: Readonly<Record<string, string | number>>;

  constructor(
    message: string,
    code: InvalidAmountCode = "internal",
    params: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "InvalidAmountError";
    this.code = code;
    this.params = params;
  }
}

/** Rounding mode used for every monetary rounding decision in Balancia. */
export const MONEY_ROUNDING = Decimal.ROUND_HALF_EVEN;

export function money(amount: bigint, currency: string): Money {
  // Validates the currency code; throws UnknownCurrencyError otherwise.
  getCurrency(currency);
  return { amount, currency };
}

export function zero(currency: string): Money {
  return money(0n, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function negateMoney(a: Money): Money {
  return { amount: -a.amount, currency: a.currency };
}

export function sumMoney(amounts: readonly Money[], currency: string): Money {
  let total = 0n;
  for (const amount of amounts) {
    if (amount.currency !== currency) {
      throw new CurrencyMismatchError(currency, amount.currency);
    }
    total += amount.amount;
  }
  return { amount: total, currency };
}

export function isZero(a: Money): boolean {
  return a.amount === 0n;
}

export function isNegative(a: Money): boolean {
  return a.amount < 0n;
}

export function isPositive(a: Money): boolean {
  return a.amount > 0n;
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export function absMoney(a: Money): Money {
  return { amount: a.amount < 0n ? -a.amount : a.amount, currency: a.currency };
}

/**
 * Parses a decimal string in *major* units ("10.50") into minor units for the
 * given currency. Rejects anything that is not a plain decimal number, and
 * anything with more fractional digits than the currency supports — silently
 * truncating a user's input would lose money.
 */
export function parseMajorAmount(input: string, currency: string): Money {
  const exponent = currencyExponent(currency);
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidAmountError(
      `"${input}" is not a valid decimal amount`,
      "notDecimal",
      { input },
    );
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > exponent) {
    throw new InvalidAmountError(
      `${currency} supports at most ${exponent} decimal place(s); received "${input}"`,
      "tooPrecise",
      { currency, places: exponent },
    );
  }
  const padded = fraction.padEnd(exponent, "0");
  const magnitude = BigInt(whole + padded);
  return { amount: negative ? -magnitude : magnitude, currency };
}

/**
 * Formats minor units as a plain decimal string in major units ("1050" → "10.50").
 * This is the machine-readable representation used in form inputs and CSV
 * exports; use `formatMoney` for anything a person reads.
 */
export function toMajorString(value: Money): string {
  const exponent = currencyExponent(value.currency);
  const negative = value.amount < 0n;
  const magnitude = negative ? -value.amount : value.amount;
  if (exponent === 0) {
    return `${negative ? "-" : ""}${magnitude.toString()}`;
  }
  const divisor = 10n ** BigInt(exponent);
  const whole = magnitude / divisor;
  const fraction = magnitude % divisor;
  const fractionText = fraction.toString().padStart(exponent, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fractionText}`;
}

/** Serializes to a JSON-safe shape: minor units as a string. */
export interface SerializedMoney {
  readonly amount: string;
  readonly currency: string;
}

export function serializeMoney(value: Money): SerializedMoney {
  return { amount: value.amount.toString(), currency: value.currency };
}

export function deserializeMoney(value: SerializedMoney): Money {
  if (!/^-?\d+$/.test(value.amount)) {
    throw new InvalidAmountError(
      `Serialized money must be an integer string of minor units, got "${value.amount}"`,
    );
  }
  return money(BigInt(value.amount), value.currency);
}

/** decimal.js view of an amount in major units — used for exchange rates only. */
export function toDecimalMajor(value: Money): Decimal {
  return new Decimal(value.amount.toString()).dividedBy(
    new Decimal(minorUnitsPerMajor(value.currency).toString()),
  );
}

/**
 * Converts an amount between currencies with a frozen exchange rate.
 *
 * The rate is defined consistently across Balancia as:
 *   1 unit of `value.currency` = `rate` units of `targetCurrency`.
 *
 * Rounding happens exactly once, half-even, at the target currency's
 * precision — so a converted amount is deterministic for a given (amount,
 * rate, target) triple, and re-running the conversion never drifts.
 */
export function convertMoney(
  value: Money,
  targetCurrency: string,
  rate: Decimal | string,
): Money {
  const decimalRate = rate instanceof Decimal ? rate : new Decimal(rate);
  if (decimalRate.isNegative() || decimalRate.isZero()) {
    throw new InvalidAmountError(
      `Exchange rate must be strictly positive, got ${decimalRate.toString()}`,
    );
  }
  const targetExponent = currencyExponent(targetCurrency);
  const sourceExponent = currencyExponent(value.currency);
  // minorTarget = minorSource * rate * 10^(targetExponent - sourceExponent)
  const scale = new Decimal(10).pow(targetExponent - sourceExponent);
  const converted = new Decimal(value.amount.toString())
    .times(decimalRate)
    .times(scale)
    .toDecimalPlaces(0, MONEY_ROUNDING);
  return { amount: BigInt(converted.toFixed(0)), currency: targetCurrency };
}

/**
 * Multiplies an amount by a plain ratio (used for percentage previews), with
 * half-even rounding to whole minor units. Allocation code must not use this:
 * splitting uses `allocate` so the parts always sum back to the total.
 */
export function multiplyMoney(value: Money, factor: Decimal | string): Money {
  const decimalFactor =
    factor instanceof Decimal ? factor : new Decimal(factor);
  const result = new Decimal(value.amount.toString())
    .times(decimalFactor)
    .toDecimalPlaces(0, MONEY_ROUNDING);
  return { amount: BigInt(result.toFixed(0)), currency: value.currency };
}

/**
 * Human-facing formatting through Intl.NumberFormat.
 *
 * The amount is handed to Intl as a decimal *string* (supported since the
 * Intl.NumberFormat v3 proposal, available in Node 20+ and every browser we
 * target), so a large balance is never routed through a float.
 *
 * `fractionDigits` narrows the display only — the amount itself is untouched,
 * and Intl does the rounding on the decimal string. Passing 0 is how a screen
 * that reads as a summary shows whole units; anything a person is checking to
 * the centime keeps the currency's own precision.
 */
export function formatMoney(
  value: Money,
  options: {
    locale?: string;
    /** "symbol" (default), "code", "name" or "none" for a bare number. */
    display?: "symbol" | "code" | "name" | "none";
    signDisplay?: Intl.NumberFormatOptions["signDisplay"];
    /** Digits after the separator; defaults to the currency's exponent. */
    fractionDigits?: number;
  } = {},
): string {
  const { locale, display = "symbol", signDisplay } = options;
  const digits = options.fractionDigits ?? currencyExponent(value.currency);
  const decimalText = toMajorString(value);
  if (display === "none") {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay,
    }).format(decimalText as unknown as number);
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    currencyDisplay: display === "symbol" ? "narrowSymbol" : display,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay,
  }).format(decimalText as unknown as number);
}
