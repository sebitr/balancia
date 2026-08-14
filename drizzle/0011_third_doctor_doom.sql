ALTER TABLE "users" ADD COLUMN "date_format" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "number_format" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_date_format_known" CHECK ("users"."date_format" IS NULL OR "users"."date_format" IN ('dmy', 'mdy', 'ymd'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_number_format_known" CHECK ("users"."number_format" IS NULL OR "users"."number_format" IN ('comma-dot', 'dot-comma', 'space-comma'));