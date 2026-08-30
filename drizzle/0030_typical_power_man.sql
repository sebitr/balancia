ALTER TYPE "public"."recurrence_frequency" ADD VALUE 'daily';--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "week_of_month" text;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "occurrence_count" integer;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_week_of_month_valid" CHECK ("recurring_expenses"."week_of_month" IS NULL OR "recurring_expenses"."week_of_month" IN ('1', '2', '3', '4', 'last'));--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_month_day_exclusive" CHECK ("recurring_expenses"."week_of_month" IS NULL OR ("recurring_expenses"."day_of_month" IS NULL AND "recurring_expenses"."weekday" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_occurrence_count_positive" CHECK ("recurring_expenses"."occurrence_count" IS NULL OR "recurring_expenses"."occurrence_count" >= 1);--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_end_exclusive" CHECK ("recurring_expenses"."occurrence_count" IS NULL OR "recurring_expenses"."end_date" IS NULL);