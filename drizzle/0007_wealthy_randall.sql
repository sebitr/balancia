CREATE TYPE "public"."entry_direction" AS ENUM('out', 'in');--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "direction" "entry_direction" DEFAULT 'out' NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "direction" "entry_direction" DEFAULT 'out' NOT NULL;