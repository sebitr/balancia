ALTER TABLE "users" ADD COLUMN "avatar_storage_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_content_type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_complete" CHECK (("users"."avatar_storage_key" IS NULL) = ("users"."avatar_content_type" IS NULL));