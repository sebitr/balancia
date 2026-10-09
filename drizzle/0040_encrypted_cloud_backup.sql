CREATE TYPE "public"."backup_destination_status" AS ENUM('setup', 'active', 'paused', 'needs_reconnect');--> statement-breakpoint
CREATE TYPE "public"."backup_frequency" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."backup_provider" AS ENUM('google_drive', 'dropbox', 'onedrive', 's3', 'webdav', 'proton_drive', 'icloud_drive');--> statement-breakpoint
CREATE TYPE "public"."backup_run_status" AS ENUM('running', 'succeeded', 'unchanged', 'failed');--> statement-breakpoint
CREATE TYPE "public"."backup_trigger" AS ENUM('schedule', 'manual');--> statement-breakpoint
CREATE TABLE "backup_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "backup_provider" NOT NULL,
	"label" text NOT NULL,
	"credentials" text NOT NULL,
	"frequency" "backup_frequency" DEFAULT 'daily' NOT NULL,
	"keep_last" integer DEFAULT 10 NOT NULL,
	"excluded_group_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"include_receipts" boolean DEFAULT false NOT NULL,
	"status" "backup_destination_status" DEFAULT 'active' NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_destinations_keep_last_range" CHECK ("backup_destinations"."keep_last" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "backup_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"recipient" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"trigger" "backup_trigger" NOT NULL,
	"status" "backup_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"group_count" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"object_name" text,
	"receipts_written" integer DEFAULT 0 NOT NULL,
	"receipts_pending" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_detail" text
);
--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD CONSTRAINT "backup_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_keys" ADD CONSTRAINT "backup_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_destination_id_backup_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."backup_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_destinations_user_idx" ON "backup_destinations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "backup_destinations_due_idx" ON "backup_destinations" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "backup_runs_destination_idx" ON "backup_runs" USING btree ("destination_id","started_at");