ALTER TYPE "public"."activity_action" ADD VALUE 'expense.restored' BEFORE 'settlement.created';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'settlement.restored' BEFORE 'member.added';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'recurring.restored' BEFORE 'recurring.generated';