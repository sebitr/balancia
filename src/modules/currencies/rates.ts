import "server-only";
import Decimal from "decimal.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { exchangeRateQuotes, expenses, groups } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
  CurrencyConfigurationError,
  EXCHANGE_RATE_SCALE,
  type CurrencyMode,
  type ExchangeRateSource,
} from "./conversion";
import { getCurrency } from "./iso-4217";
import { getRatesProvider, todayIso, type ProviderQuotes } from "./provider";

/**
 * Rate lookups, cached in PostgreSQL.
 *
 * Two rules shape this module:
 *
 *  1. A suggestion is never load-bearing. Every failure — provider off,
 *     unreachable, currency unsupported — returns null, and the form falls back
 *     to a typed rate.
 *  2. A rate written onto an expense is frozen there forever. Nothing here
 *     rewrites history; this cache only decides what to *suggest*, and it can
 *     be truncated at any time without changing a single balance.
 */

export interface QuotedRate {
  /** 1 unit of `from` in `to`, as a decimal string. */
  readonly rate: string;
  /** Business day the provider priced, which may precede the day requested. */
  readonly quotedOn: string;
  readonly provider: string;
}

/**
 * How long a quote for a day that is not yet closed may be reused.
 *
 * Reference rates are published once, mid-afternoon. A quote fetched this
 * morning carries yesterday's fixing, so today's row has to expire; a row for
 * a day already past never does.
 */
const PROVISIONAL_TTL_MS = 60 * 60 * 1000;

/** Days of history a scheduled refresh considers a currency pair "in use". */
const ACTIVE_PAIR_WINDOW_DAYS = 90;

interface CachedQuote {
  readonly rateDate: string;
  readonly quotedOn: string;
  readonly rate: string;
  readonly provider: string;
  readonly fetchedAt: Date;
}

/**
 * Whether a cached row can be served without asking the provider again.
 *
 * A row is final once its day is over: the fixing for a past date does not
 * change, including on weekends, where the roll-back to the previous business
 * day is itself permanent. Only rows for today (or a future expense date,
 * which the provider answers with the latest fixing) are provisional.
 */
export function isQuoteFresh(
  quote: CachedQuote,
  now: Date = new Date(),
): boolean {
  if (quote.rateDate < todayIso(now)) return true;
  if (quote.quotedOn >= quote.rateDate) return true;
  return now.getTime() - quote.fetchedAt.getTime() < PROVISIONAL_TTL_MS;
}

/** Trims the scale PostgreSQL pads a numeric to: "1.154500000000" → "1.1545". */
function tidyRate(stored: string): string {
  return new Decimal(stored).toDecimalPlaces(EXCHANGE_RATE_SCALE).toFixed();
}

async function readCachedQuote(params: {
  provider: string;
  from: string;
  to: string;
  on: string;
}): Promise<CachedQuote | null> {
  const db = getDb();
  const [row] = await db
    .select({
      rateDate: exchangeRateQuotes.rateDate,
      quotedOn: exchangeRateQuotes.quotedOn,
      rate: exchangeRateQuotes.rate,
      provider: exchangeRateQuotes.provider,
      fetchedAt: exchangeRateQuotes.fetchedAt,
    })
    .from(exchangeRateQuotes)
    .where(
      and(
        eq(exchangeRateQuotes.provider, params.provider),
        eq(exchangeRateQuotes.baseCurrency, params.from),
        eq(exchangeRateQuotes.quoteCurrency, params.to),
        eq(exchangeRateQuotes.rateDate, params.on),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Stores every quote from one provider response; they cost nothing to keep. */
async function storeQuotes(
  quotes: ProviderQuotes,
  rateDate: string,
  now: Date,
): Promise<void> {
  const rows = [...quotes.rates].map(([quoteCurrency, rate]) => ({
    provider: quotes.provider,
    baseCurrency: quotes.base,
    quoteCurrency,
    rateDate,
    quotedOn: quotes.quotedOn,
    rate,
    fetchedAt: now,
  }));
  if (rows.length === 0) return;

  const db = getDb();
  await db
    .insert(exchangeRateQuotes)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        exchangeRateQuotes.provider,
        exchangeRateQuotes.baseCurrency,
        exchangeRateQuotes.quoteCurrency,
        exchangeRateQuotes.rateDate,
      ],
      set: {
        rate: sql`excluded.rate`,
        quotedOn: sql`excluded.quoted_on`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
}

/**
 * The rate to suggest for `from` → `to` on `on` (`YYYY-MM-DD`), or null when no
 * suggestion can be made.
 *
 * Reads the cache first; on a miss or a stale row, asks the provider and stores
 * everything that came back. If the provider is unreachable but a stale row
 * exists, the stale row is served — an hour-old rate beats no rate.
 */
export async function lookupRate(params: {
  from: string;
  to: string;
  on: string;
  now?: Date;
}): Promise<QuotedRate | null> {
  const { from, to, on } = params;
  const now = params.now ?? new Date();

  getCurrency(from);
  getCurrency(to);
  if (from === to) {
    throw new CurrencyConfigurationError(
      "A rate lookup needs two different currencies",
    );
  }

  const provider = getRatesProvider();
  if (!provider) return null;

  const cached = await readCachedQuote({
    provider: provider.name,
    from,
    to,
    on,
  });
  if (cached && isQuoteFresh(cached, now)) {
    return {
      rate: tidyRate(cached.rate),
      quotedOn: cached.quotedOn,
      provider: cached.provider,
    };
  }

  let quotes: ProviderQuotes | null;
  try {
    quotes = await provider.fetchQuotes({ base: from, on });
  } catch (error) {
    logger.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        provider: provider.name,
        from,
        to,
        on,
      },
      "Exchange-rate lookup failed",
    );
    // A rate we already hold is still a better answer than none.
    return cached
      ? {
          rate: tidyRate(cached.rate),
          quotedOn: cached.quotedOn,
          provider: cached.provider,
        }
      : null;
  }

  if (!quotes) return null;
  await storeQuotes(quotes, on, now);

  const rate = quotes.rates.get(to);
  return rate
    ? { rate, quotedOn: quotes.quotedOn, provider: quotes.provider }
    : null;
}

/**
 * Whether `rate` is one this instance actually fetched for that pair and day.
 *
 * Provenance is recorded server-side rather than taken from the client: a form
 * that says "this rate came from the provider" is only believed if the cache
 * agrees. Cache-only, so it never adds a network call to a write.
 */
export async function isProviderQuotedRate(params: {
  from: string;
  to: string;
  on: string;
  rate: string;
}): Promise<boolean> {
  const provider = getRatesProvider();
  if (!provider || params.from === params.to) return false;

  const cached = await readCachedQuote({
    provider: provider.name,
    from: params.from,
    to: params.to,
    on: params.on,
  });
  if (!cached) return false;

  try {
    return new Decimal(cached.rate).equals(new Decimal(params.rate));
  } catch {
    return false;
  }
}

/**
 * Where a rate about to be written came from.
 *
 * Provenance is decided here, from the cache, rather than taken from whatever
 * the form claims: a rate is labelled `api` only if it is the one this instance
 * actually holds for that pair and day. Everything else is `manual`, which is
 * the honest answer for a typed rate — including one typed to match.
 */
export async function classifyRateSource(params: {
  mode: CurrencyMode;
  baseCurrency: string | null;
  currency: string;
  rate?: string;
  on: string;
}): Promise<ExchangeRateSource> {
  const { mode, baseCurrency, currency, rate, on } = params;
  if (
    mode !== "converted" ||
    !baseCurrency ||
    !rate ||
    currency === baseCurrency
  ) {
    return "manual";
  }
  const quoted = await isProviderQuotedRate({
    from: currency,
    to: baseCurrency,
    on,
    rate,
  });
  return quoted ? "api" : "manual";
}

export interface RateRefreshReport {
  readonly pairs: number;
  readonly fetched: number;
  readonly missing: number;
}

/**
 * Warms today's rates for the currency pairs converted groups actually use.
 *
 * Runs on a schedule after the daily fixing so the first person to add a
 * foreign-currency expense gets an instant suggestion, and so a provider
 * outage during the day is survivable — the cache already holds the answer.
 */
export async function refreshActiveRates(
  options: { now?: Date } = {},
): Promise<RateRefreshReport> {
  const now = options.now ?? new Date();
  const provider = getRatesProvider();
  if (!provider) return { pairs: 0, fetched: 0, missing: 0 };

  const cutoff = new Date(
    now.getTime() - ACTIVE_PAIR_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const db = getDb();
  const pairs = await db
    .selectDistinct({
      from: expenses.currency,
      to: groups.baseCurrency,
    })
    .from(expenses)
    .innerJoin(groups, eq(groups.id, expenses.groupId))
    .where(
      and(
        eq(groups.currencyMode, "converted"),
        isNull(groups.archivedAt),
        isNull(expenses.deletedAt),
        sql`${expenses.currency} <> ${groups.baseCurrency}`,
        sql`${expenses.expenseDate} >= ${todayIso(cutoff)}`,
      ),
    );

  const on = todayIso(now);
  let fetched = 0;
  let missing = 0;
  for (const pair of pairs) {
    if (!pair.to) continue;
    // One provider call per base currency populates every quote from that
    // response, so same-base pairs after the first are cache hits.
    const quote = await lookupRate({ from: pair.from, to: pair.to, on, now });
    if (quote) fetched += 1;
    else missing += 1;
  }

  return { pairs: pairs.length, fetched, missing };
}

/** Deletes cached quotes nobody will ask for again. Called by the sweep job. */
export async function pruneRateQuotes(olderThan: Date): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(exchangeRateQuotes)
    .where(sql`${exchangeRateQuotes.fetchedAt} < ${olderThan}`)
    .returning({ id: exchangeRateQuotes.id });
  return deleted.length;
}
