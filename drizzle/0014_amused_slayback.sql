ALTER TYPE "public"."verification_purpose" ADD VALUE 'email_change';--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD COLUMN "new_email" text;