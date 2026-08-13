import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Cached exchange-rate quotes from an external provider.
 *
 * This table is a cache, never a source of truth: the rate that matters for an
 * expense is the one frozen on the expense row itself. Deleting everything here
 * changes no balance — it only causes the next lookup to hit the provider
 * again.
 *
 * `rateDate` is the day the rate was *asked for*; `quotedOn` is the business
 * day the provider actually priced. They differ on weekends and holidays, when
 * reference rates roll back to the previous fixing. Keeping both means a
 * Saturday lookup is a cache hit the second time, while the record still says
 * honestly which day's fixing it carries.
 */
export const exchangeRateQuotes = pgTable(
  "exchange_rate_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Provider identifier, e.g. "frankfurter". */
    provider: text("provider").notNull(),
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rateDate: date("rate_date").notNull(),
    quotedOn: date("quoted_on").notNull(),
    /** 1 unit of `baseCurrency` in `quoteCurrency`. */
    rate: numeric("rate", { precision: 30, scale: 12 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("exchange_rate_quotes_lookup_unique").on(
      table.provider,
      table.baseCurrency,
      table.quoteCurrency,
      table.rateDate,
    ),
    index("exchange_rate_quotes_fetched_idx").on(table.fetchedAt),
    check("exchange_rate_quotes_rate_positive", sql`${table.rate} > 0`),
    check(
      "exchange_rate_quotes_currency_format",
      sql`${table.baseCurrency} ~ '^[A-Z]{3}$' AND ${table.quoteCurrency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "exchange_rate_quotes_distinct_currencies",
      sql`${table.baseCurrency} <> ${table.quoteCurrency}`,
    ),
  ],
);
