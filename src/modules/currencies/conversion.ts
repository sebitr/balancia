import Decimal from "decimal.js";
import { convertMoney, money, type Money } from "./money";
import { getCurrency } from "./iso-4217";

/**
 * Group currency modes and the rules for freezing exchange rates.
 *
 * `separate`  — every currency keeps its own balance. Nothing is converted.
 * `converted` — every expense is expressed in the group's base currency using
 *               a rate captured *at the time the expense was recorded*. That
 *               rate is stored with the expense and never recomputed, so
 *               history does not silently change when rates move.
 */

export const CURRENCY_MODES = ["separate", "converted"] as const;
export type CurrencyMode = (typeof CURRENCY_MODES)[number];

export const EXCHANGE_RATE_SOURCES = ["manual", "import"] as const;
export type ExchangeRateSource = (typeof EXCHANGE_RATE_SOURCES)[number];

export class CurrencyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurrencyConfigurationError";
  }
}

/**
 * A rate is always read as: 1 unit of `fromCurrency` = `rate` units of
 * `toCurrency`. Storing the direction explicitly removes the classic
 * "which way round is this rate?" bug class.
 */
export interface FrozenExchangeRate {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  /** Decimal string, e.g. "1.0854". Stored as PostgreSQL numeric. */
  readonly rate: string;
  readonly source: ExchangeRateSource;
  readonly capturedAt: Date;
}

/** Maximum decimal places kept for a stored rate. */
export const EXCHANGE_RATE_SCALE = 12;

export function parseExchangeRate(input: string): Decimal {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new CurrencyConfigurationError(
      `Exchange rate must be a positive decimal number, received "${input}"`,
    );
  }
  const rate = new Decimal(trimmed);
  if (rate.isZero()) {
    throw new CurrencyConfigurationError(
      "Exchange rate must be greater than zero",
    );
  }
  if (rate.decimalPlaces() > EXCHANGE_RATE_SCALE) {
    throw new CurrencyConfigurationError(
      `Exchange rate supports at most ${EXCHANGE_RATE_SCALE} decimal places`,
    );
  }
  return rate;
}

export interface ConversionRequest {
  readonly mode: CurrencyMode;
  /** Group base currency; required when mode is "converted". */
  readonly baseCurrency: string | null;
  readonly amount: Money;
  /** Required when converting between different currencies. */
  readonly rate?: string;
  readonly source?: ExchangeRateSource;
  readonly capturedAt?: Date;
}

export interface ConversionResult {
  /** The amount as recorded by the user, untouched. */
  readonly original: Money;
  /**
   * The amount balances are computed from. In `separate` mode this is the
   * original; in `converted` mode it is the base-currency equivalent.
   */
  readonly effective: Money;
  /** Present only when an actual conversion happened. */
  readonly frozenRate: FrozenExchangeRate | null;
}

/**
 * Resolves what a group should store for an expense or settlement amount.
 *
 * Called once, when the record is written. The result is persisted; reads never
 * re-run conversion, which is what keeps historical figures stable.
 */
export function resolveConversion(
  request: ConversionRequest,
): ConversionResult {
  const {
    mode,
    baseCurrency,
    amount,
    rate,
    source = "manual",
    capturedAt,
  } = request;

  if (mode === "separate") {
    if (rate !== undefined) {
      throw new CurrencyConfigurationError(
        "Separate-currency groups do not convert amounts, so an exchange rate cannot be applied",
      );
    }
    return { original: amount, effective: amount, frozenRate: null };
  }

  if (!baseCurrency) {
    throw new CurrencyConfigurationError(
      "A converted-currency group must define a base currency",
    );
  }
  getCurrency(baseCurrency);

  if (amount.currency === baseCurrency) {
    if (rate !== undefined && !parseExchangeRate(rate).equals(1)) {
      throw new CurrencyConfigurationError(
        "An exchange rate cannot be applied when the amount is already in the base currency",
      );
    }
    return { original: amount, effective: amount, frozenRate: null };
  }

  if (rate === undefined) {
    throw new CurrencyConfigurationError(
      `An exchange rate is required to record a ${amount.currency} amount in a group based on ${baseCurrency}`,
    );
  }

  const decimalRate = parseExchangeRate(rate);
  const converted = convertMoney(amount, baseCurrency, decimalRate);

  return {
    original: amount,
    effective: converted,
    frozenRate: {
      fromCurrency: amount.currency,
      toCurrency: baseCurrency,
      rate: decimalRate.toString(),
      source,
      capturedAt: capturedAt ?? new Date(),
    },
  };
}

/**
 * Re-derives the effective amount from what was stored, without recalculating
 * the rate. Used when reading an expense back: the stored converted amount is
 * authoritative, and this only exists to reconstruct a Money value from
 * database columns.
 */
export function effectiveAmountFromStored(params: {
  readonly mode: CurrencyMode;
  readonly baseCurrency: string | null;
  readonly originalAmount: bigint;
  readonly originalCurrency: string;
  readonly convertedAmount: bigint | null;
}): Money {
  const {
    mode,
    baseCurrency,
    originalAmount,
    originalCurrency,
    convertedAmount,
  } = params;
  if (mode === "separate") {
    return money(originalAmount, originalCurrency);
  }
  if (!baseCurrency) {
    throw new CurrencyConfigurationError(
      "A converted-currency group must define a base currency",
    );
  }
  if (originalCurrency === baseCurrency) {
    return money(originalAmount, baseCurrency);
  }
  if (convertedAmount === null) {
    throw new CurrencyConfigurationError(
      "A foreign-currency amount in a converted group must have a stored converted amount",
    );
  }
  return money(convertedAmount, baseCurrency);
}

/** Currency a group's balances are expressed in, per mode. */
export function balanceCurrencies(params: {
  readonly mode: CurrencyMode;
  readonly baseCurrency: string | null;
  readonly usedCurrencies: readonly string[];
}): string[] {
  if (params.mode === "converted") {
    if (!params.baseCurrency) {
      throw new CurrencyConfigurationError(
        "A converted-currency group must define a base currency",
      );
    }
    return [params.baseCurrency];
  }
  return [...new Set(params.usedCurrencies)].sort();
}
