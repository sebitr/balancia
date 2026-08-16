CREATE TYPE "public"."telemetry_report_kind" AS ENUM('usage', 'crash');--> statement-breakpoint
CREATE TYPE "public"."telemetry_send_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"usage_reporting_enabled" boolean DEFAULT false NOT NULL,
	"crash_reporting_enabled" boolean DEFAULT false NOT NULL,
	"usage_reporting_changed_at" timestamp with time zone,
	"crash_reporting_changed_at" timestamp with time zone,
	"last_report_attempt_at" timestamp with time zone,
	"last_report_status" "telemetry_send_status",
	"last_report_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_singleton" CHECK ("instance_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "telemetry_counters" (
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "telemetry_counters_day_metric_pk" PRIMARY KEY("day","metric"),
	CONSTRAINT "telemetry_counters_count_positive" CHECK ("telemetry_counters"."count" >= 0),
	CONSTRAINT "telemetry_counters_metric_shape" CHECK ("telemetry_counters"."metric" ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_-]+){0,2}$' AND length("telemetry_counters"."metric") <= 64)
);
--> statement-breakpoint
CREATE TABLE "telemetry_daily_stats" (
	"day" date NOT NULL,
	"kind" "telemetry_report_kind" NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "telemetry_daily_stats_day_kind_field_value_pk" PRIMARY KEY("day","kind","field","value")
);
--> statement-breakpoint
CREATE TABLE "telemetry_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_on" date NOT NULL,
	"kind" "telemetry_report_kind" NOT NULL,
	"schema_version" integer NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "telemetry_counters_day_idx" ON "telemetry_counters" USING btree ("day");--> statement-breakpoint
CREATE INDEX "telemetry_daily_stats_day_idx" ON "telemetry_daily_stats" USING btree ("day");--> statement-breakpoint
CREATE INDEX "telemetry_reports_received_idx" ON "telemetry_reports" USING btree ("received_on");--> statement-breakpoint
-- The settings row exists from the start rather than being created on first
-- write, so every reader can assume one row and no request path has to take a
-- write lock to find out that telemetry is off.
INSERT INTO "instance_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Existing installations have no administrator yet. The oldest account is the
-- one that created the instance — on a self-hosted deployment that is the
-- operator — so it inherits the flag. New installations start with no users at
-- all and the first registration claims it instead (src/modules/auth/service.ts).
-- Promoting anyone else is one UPDATE; see docs/telemetry.md.
UPDATE "users" SET "is_admin" = true
WHERE "id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC, "id" ASC LIMIT 1);
