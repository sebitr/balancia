CREATE TYPE "public"."category_mapping_scope" AS ENUM('user', 'group');--> statement-breakpoint
CREATE TABLE "expense_category_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "category_mapping_scope" NOT NULL,
	"user_id" uuid,
	"group_id" uuid,
	"raw_merchant" text NOT NULL,
	"normalized_merchant" text NOT NULL,
	"category" text NOT NULL,
	"transaction_type" text,
	"correction_count" integer DEFAULT 1 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_category_mappings_scope_owner" CHECK (("expense_category_mappings"."scope" = 'group' AND "expense_category_mappings"."group_id" IS NOT NULL AND "expense_category_mappings"."user_id" IS NULL)
          OR ("expense_category_mappings"."scope" = 'user' AND "expense_category_mappings"."user_id" IS NOT NULL AND "expense_category_mappings"."group_id" IS NULL)),
	CONSTRAINT "expense_category_mappings_counts_non_negative" CHECK ("expense_category_mappings"."correction_count" >= 0 AND "expense_category_mappings"."conflict_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "expense_category_mappings" ADD CONSTRAINT "expense_category_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_category_mappings" ADD CONSTRAINT "expense_category_mappings_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_category_mappings_group_merchant_unique" ON "expense_category_mappings" USING btree ("group_id","normalized_merchant") WHERE "expense_category_mappings"."scope" = 'group';--> statement-breakpoint
CREATE UNIQUE INDEX "expense_category_mappings_user_merchant_unique" ON "expense_category_mappings" USING btree ("user_id","normalized_merchant") WHERE "expense_category_mappings"."scope" = 'user';--> statement-breakpoint
CREATE INDEX "expense_category_mappings_normalized_idx" ON "expense_category_mappings" USING btree ("normalized_merchant");--> statement-breakpoint
CREATE INDEX "expense_category_mappings_group_idx" ON "expense_category_mappings" USING btree ("group_id","last_used_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expense_category_mappings_user_idx" ON "expense_category_mappings" USING btree ("user_id","last_used_at" DESC NULLS LAST);