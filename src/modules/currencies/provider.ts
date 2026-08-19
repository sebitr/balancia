import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { EXCHANGE_RATE_SCALE } from "./conversion";

/**
 * External exchange-rate providers.
 *
 * Balancia never *needs* a provider: a rate can always be typed in, and every
 * recorded rate is frozen on its expense. A provider only removes the typing,
 * which is why it is opt-in (`EXCHANGE_RATE_PROVIDER`) and why every failure
 * here degrades to "no suggestion" rather than to an error the user must deal
 * with.
 *
 * The default implementation talks to Frankfurter's v2 API, which blends the
 * daily rates published by some eighty central banks: no API key, no account,
 * no per-request identity, and self-hostable if an instance would rather not
 * talk to a third party at all (`EXCHANGE_RATE_API_URL`).
 *
 * v1 is deliberately not spoken here. It republishes the European Central Bank
 * alone, which prices thirty currencies — so a group settling in AED, UAH or
 * any of the other hundred and thirty-five the picker offers got silence
 * rather than a rate. `env.ts` refuses a URL still pointing at it.
 */

/** One currency's price against the base, on the day it was last priced. */
export interface ProviderQuote {
  /** 1 base = rate quote, as a decimal string. */
  readonly rate: string;
  /**
   * Business day this pair was actually priced, `YYYY-MM-DD`.
   *
   * Per quote rather than per response: rates are blended across providers
   * that do not all publish on the same schedule, so one response routinely
   * carries three different days. A thinly traded pair rolls further back than
   * a liquid one, and each row has to say which day it belongs to.
   */
  readonly quotedOn: string;
}

/** Quotes for one base currency on one day. */
export interface ProviderQuotes {
  readonly provider: string;
  readonly base: string;
  /** Quote currency → its quote. */
  readonly rates: ReadonlyMap<string, ProviderQuote>;
}

export interface RatesProvider {
  readonly name: string;
  /**
   * All quotes for `base` on `on` (`YYYY-MM-DD`), or null when the provider
   * has nothing for that pair of arguments — an unsupported currency, or a
   * date outside its history. Throws `RateProviderError` when the provider
   * itself is unreachable or answers with something unusable.
   */
  fetchQuotes(params: {
    base: string;
    on: string;
    signal?: AbortSignal;
  }): Promise<ProviderQuotes | null>;
}

export class RateProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RateProviderError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Request timeout. A rate suggestion is a convenience; it must not hang a form. */
const REQUEST_TIMEOUT_MS = 5_000;

const responseSchema = z.array(
  z.object({
    date: z.string().regex(ISO_DATE),
    base: z.string(),
    quote: z.string(),
    rate: z.number(),
  }),
);

/** Today in UTC as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Normalizes a rate from JSON to the decimal string the database stores.
 *
 * Reference rates carry a handful of significant digits, so the JSON number
 * round-trips exactly; `Decimal` is used to avoid exponent notation and to cap
 * the scale at what the column accepts.
 */
function normalizeRate(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Decimal(value)
    .toDecimalPlaces(EXCHANGE_RATE_SCALE, Decimal.ROUND_HALF_EVEN)
    .toFixed();
}

export function createFrankfurterProvider(baseUrl: string): RatesProvider {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    name: "frankfurter",

    async fetchQuotes({ base, on, signal }) {
      if (!ISO_DATE.test(on)) {
        throw new RateProviderError(`"${on}" is not an ISO date`);
      }
      // A date in the future answers with an empty list rather than an error.
      // Omit it instead and take the newest fixing, letting each row say which
      // day it belongs to.
      const query = new URLSearchParams({ base });
      if (on < todayIso()) query.set("date", on);
      const url = `${root}/rates?${query}`;

      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
      } catch (error) {
        throw new RateProviderError(
          `Could not reach the exchange-rate provider at ${root}`,
          { cause: error },
        );
      }

      // 404 is "no such resource", 422 "no such currency". Both are the
      // provider saying it has nothing, which is an answer rather than a
      // failure; a date outside its history comes back as an empty list.
      if (response.status === 404 || response.status === 422) return null;
      if (!response.ok) {
        throw new RateProviderError(
          `Exchange-rate provider answered ${response.status}`,
        );
      }

      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new RateProviderError(
          "Exchange-rate provider returned an unexpected payload",
        );
      }

      const rates = new Map<string, ProviderQuote>();
      for (const row of parsed.data) {
        if (!/^[A-Z]{3}$/.test(row.quote) || row.quote === base) continue;
        const rate = normalizeRate(row.rate);
        if (rate) rates.set(row.quote, { rate, quotedOn: row.date });
      }
      if (rates.size === 0) return null;

      return { provider: "frankfurter", base, rates };
    },
  };
}

let cachedProvider: RatesProvider | null | undefined;

/** The configured provider, or null when rate lookups are switched off. */
export function getRatesProvider(): RatesProvider | null {
  if (cachedProvider !== undefined) return cachedProvider;
  const env = getEnv();
  cachedProvider =
    env.EXCHANGE_RATE_PROVIDER === "frankfurter"
      ? createFrankfurterProvider(env.EXCHANGE_RATE_API_URL)
      : null;
  return cachedProvider;
}

/** Test hook: forget the memoized provider. */
export function resetRatesProviderCache(): void {
  cachedProvider = undefined;
}
