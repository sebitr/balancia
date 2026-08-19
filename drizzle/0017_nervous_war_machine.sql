CREATE TABLE "group_join_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "group_join_links" ADD CONSTRAINT "group_join_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_join_links" ADD CONSTRAINT "group_join_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_join_links_token_hash_unique" ON "group_join_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "group_join_links_group_idx" ON "group_join_links" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_join_links_active_group_unique" ON "group_join_links" USING btree ("group_id") WHERE "group_join_links"."revoked_at" IS NULL;