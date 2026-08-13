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
 * The default implementation talks to Frankfurter, which republishes the
 * European Central Bank's daily reference rates: no API key, no account, no
 * per-request identity, and self-hostable if an instance would rather not talk
 * to a third party at all (`EXCHANGE_RATE_API_URL`).
 */

/** Quotes for one base currency on one day. */
export interface ProviderQuotes {
  readonly provider: string;
  readonly base: string;
  /** Business day actually priced, `YYYY-MM-DD`. */
  readonly quotedOn: string;
  /** Quote currency → decimal string; 1 base = rate quote. */
  readonly rates: ReadonlyMap<string, string>;
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

const responseSchema = z.object({
  base: z.string(),
  date: z.string().regex(ISO_DATE),
  rates: z.record(z.string(), z.number()),
});

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
      // The endpoint has no future: ask for the newest fixing instead, and let
      // the response say which day it belongs to.
      const path = on >= todayIso() ? "latest" : on;
      const url = `${root}/${path}?base=${encodeURIComponent(base)}`;

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

      // 404 is how Frankfurter says "no data for this currency or date". That
      // is an answer, not a failure.
      if (response.status === 404) return null;
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

      const rates = new Map<string, string>();
      for (const [currency, value] of Object.entries(parsed.data.rates)) {
        if (!/^[A-Z]{3}$/.test(currency) || currency === base) continue;
        const rate = normalizeRate(value);
        if (rate) rates.set(currency, rate);
      }
      if (rates.size === 0) return null;

      return {
        provider: "frankfurter",
        base,
        quotedOn: parsed.data.date,
        rates,
      };
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
