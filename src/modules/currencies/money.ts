import Decimal from "decimal.js";
import { currencyExponent, getCurrency } from "./iso-4217";

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

/**
 * The largest amount Balancia accepts or stores, in minor units, either sign.
 *
 * Nine times short of what the `bigint` columns can hold, which is the point:
 * an amount under this line can never be the value PostgreSQL refuses, and a
 * refusal there is a 500 where the person should have been told the number
 * was too large.
 */
export const MAX_MINOR_UNITS = 10n ** 18n;

/**
 * The decimal.js constructor money arithmetic goes through.
 *
 * decimal.js rounds the result of each operation to `precision` significant
 * digits, and its default is twenty — fewer than one product Balancia makes.
 * An amount is up to nineteen digits of minor units and a rate up to
 * twenty-two, so a conversion was rounded once in the middle, before the one
 * rounding it is documented to make, and came out a unit off.
 *
 * Sixty-four digits holds that product exactly, and still leaves some
 * forty-five places below the point when a part is scaled by the ratio of two
 * totals. A split's shares do not come through here at all:
 * `allocateByWeights` works in whole numbers. A clone rather than
 * `Decimal.set`, so nothing else that imports decimal.js has its arithmetic
 * changed underneath it.
 *
 * Every operation is rounded at the precision of the instance it is called
 * on, not of its argument, so a `MoneyDecimal` goes on the left.
 */
export const MoneyDecimal = Decimal.clone({ precision: 64 });

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
  const decimalRate = new MoneyDecimal(rate);
  if (decimalRate.isNegative() || decimalRate.isZero()) {
    throw new InvalidAmountError(
      `Exchange rate must be strictly positive, got ${decimalRate.toString()}`,
    );
  }
  const targetExponent = currencyExponent(targetCurrency);
  const sourceExponent = currencyExponent(value.currency);
  // minorTarget = minorSource * rate * 10^(targetExponent - sourceExponent)
  const scale = new MoneyDecimal(10).pow(targetExponent - sourceExponent);
  const converted = new MoneyDecimal(value.amount.toString())
    .times(decimalRate)
    .times(scale)
    .toDecimalPlaces(0, MONEY_ROUNDING);
  return { amount: BigInt(converted.toFixed(0)), currency: targetCurrency };
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
 *
 * **One way of writing money.** Every figure in the app is written in Intl's
 * `symbol` display, in the reader's number notation: "€60.00", "CHF 60.00",
 * "60,00 €". There is no option for the currency code. The group overview and
 * the settle-up screen used to ask for it, so the €60.00 on the home screen
 * read "EUR 60.00" one tap later and "€60.00" again in the transactions after
 * that — one amount, two spellings, two taps apart.
 *
 * `symbol`, not `narrowSymbol`. The narrow form writes "$" for the US,
 * Canadian and Australian dollar alike and "kr" for all three Scandinavian
 * krone, so a group holding two of them showed two figures nobody could tell
 * apart. `symbol` is CLDR's answer to exactly that: the bare sign where the
 * reader's notation leaves no doubt ("€", "$" in American English, "£"), a
 * prefixed one where it would ("CA$", "US$" in British English, "£GB" in
 * French), and the code where there is nothing better ("CHF", "SEK"). Each
 * figure says its own currency, so two can sit side by side without a
 * heading, and no call site needs to reach for the code to get there.
 *
 * The two exceptions are not other spellings — they are the currency said
 * once, apart from the number:
 * - `display: "none"`, a bare number, where the row, column or heading has
 *   already named the currency: a currency's row on a multi-currency
 *   overview, the compact spending lines, a legend under its own figure.
 * - The display-size headline of a screen (`BigAmount` on an entry,
 *   `HeroAmount` on the group's position) sets the ISO code on the numeral's
 *   baseline as a qualifier and draws the numeral bare beside it, as
 *   `design-system/src/pages/patterns/money.html` draws it under "One entry".
 *
 * Both are written out on that page; a new exception goes there and here.
 */
export function formatMoney(
  value: Money,
  options: {
    locale?: string;
    /**
     * "symbol" (default), or "none" for a bare number whose currency is
     * already named beside it. See above for why there is nothing else.
     */
    display?: "symbol" | "none";
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
    currencyDisplay: "symbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay,
  }).format(decimalText as unknown as number);
}
