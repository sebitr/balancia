CREATE TABLE "payout_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_methods_position_positive" CHECK ("payout_methods"."position" >= 0),
	CONSTRAINT "payout_methods_method_format" CHECK ("payout_methods"."method" ~ '^[a-z0-9_]{2,40}$'),
	CONSTRAINT "payout_methods_detail_bounded" CHECK (length("payout_methods"."detail") <= 120)
);
--> statement-breakpoint
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_methods_user_method_unique" ON "payout_methods" USING btree ("user_id","method");--> statement-breakpoint
CREATE INDEX "payout_methods_user_idx" ON "payout_methods" USING btree ("user_id","position");