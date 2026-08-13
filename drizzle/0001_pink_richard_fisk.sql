ALTER TYPE "public"."exchange_rate_source" ADD VALUE 'api';--> statement-breakpoint
CREATE TABLE "exchange_rate_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate_date" date NOT NULL,
	"quoted_on" date NOT NULL,
	"rate" numeric(30, 12) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rate_quotes_rate_positive" CHECK ("exchange_rate_quotes"."rate" > 0),
	CONSTRAINT "exchange_rate_quotes_currency_format" CHECK ("exchange_rate_quotes"."base_currency" ~ '^[A-Z]{3}$' AND "exchange_rate_quotes"."quote_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "exchange_rate_quotes_distinct_currencies" CHECK ("exchange_rate_quotes"."base_currency" <> "exchange_rate_quotes"."quote_currency")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rate_quotes_lookup_unique" ON "exchange_rate_quotes" USING btree ("provider","base_currency","quote_currency","rate_date");--> statement-breakpoint
CREATE INDEX "exchange_rate_quotes_fetched_idx" ON "exchange_rate_quotes" USING btree ("fetched_at");