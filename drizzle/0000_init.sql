CREATE TYPE "public"."actor_type" AS ENUM('user', 'guest', 'system');--> statement-breakpoint
CREATE TYPE "public"."currency_mode" AS ENUM('separate', 'converted');--> statement-breakpoint
CREATE TYPE "public"."exchange_rate_source" AS ENUM('manual', 'import');--> statement-breakpoint
CREATE TYPE "public"."group_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."recurrence_frequency" AS ENUM('weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."split_method" AS ENUM('equal', 'exact', 'percentage', 'shares');--> statement-breakpoint
CREATE TYPE "public"."verification_purpose" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."activity_action" AS ENUM('expense.created', 'expense.updated', 'expense.deleted', 'settlement.created', 'settlement.updated', 'settlement.deleted', 'member.added', 'member.removed', 'member.role_changed', 'participant.created', 'participant.updated', 'participant.removed', 'guest_link.created', 'guest_link.revoked', 'guest_link.redeemed', 'recurring.created', 'recurring.updated', 'recurring.deleted', 'recurring.generated', 'import.completed', 'group.created', 'group.updated', 'group.archived');--> statement-breakpoint
CREATE TYPE "public"."import_row_kind" AS ENUM('expense', 'settlement', 'participant');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('pending', 'imported', 'skipped_duplicate', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."import_run_status" AS ENUM('uploaded', 'parsed', 'ready', 'importing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_source_format" AS ENUM('splitwise_csv', 'splitwise_json');--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "verification_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"challenge" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"role" "group_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"currency_mode" "currency_mode" DEFAULT 'separate' NOT NULL,
	"base_currency" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_by_user_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_converted_requires_base_currency" CHECK (("groups"."currency_mode" <> 'converted') OR ("groups"."base_currency" IS NOT NULL)),
	CONSTRAINT "groups_base_currency_format" CHECK ("groups"."base_currency" IS NULL OR "groups"."base_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "expense_payers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"converted_amount" bigint,
	CONSTRAINT "expense_payers_amount_non_negative" CHECK ("expense_payers"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expense_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"converted_amount" bigint
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"description" text NOT NULL,
	"notes" text,
	"category" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"converted_amount" bigint,
	"converted_currency" text,
	"exchange_rate" numeric(30, 12),
	"exchange_rate_source" "exchange_rate_source",
	"exchange_rate_at" timestamp with time zone,
	"split_method" "split_method" NOT NULL,
	"split_input" jsonb,
	"expense_date" date NOT NULL,
	"created_by_actor_type" "actor_type" NOT NULL,
	"created_by_participant_id" uuid,
	"recurring_expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "expenses_amount_non_negative" CHECK ("expenses"."amount" >= 0),
	CONSTRAINT "expenses_currency_format" CHECK ("expenses"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "expenses_conversion_complete" CHECK (("expenses"."converted_amount" IS NULL AND "expenses"."exchange_rate" IS NULL AND "expenses"."converted_currency" IS NULL)
          OR ("expenses"."converted_amount" IS NOT NULL AND "expenses"."exchange_rate" IS NOT NULL AND "expenses"."converted_currency" IS NOT NULL)),
	CONSTRAINT "expenses_exchange_rate_positive" CHECK ("expenses"."exchange_rate" IS NULL OR "expenses"."exchange_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"from_participant_id" uuid NOT NULL,
	"to_participant_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"converted_amount" bigint,
	"converted_currency" text,
	"exchange_rate" numeric(30, 12),
	"exchange_rate_source" "exchange_rate_source",
	"exchange_rate_at" timestamp with time zone,
	"notes" text,
	"settled_on" date NOT NULL,
	"created_by_actor_type" "actor_type" NOT NULL,
	"created_by_participant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "settlements_amount_positive" CHECK ("settlements"."amount" > 0),
	CONSTRAINT "settlements_currency_format" CHECK ("settlements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "settlements_distinct_parties" CHECK ("settlements"."from_participant_id" <> "settlements"."to_participant_id"),
	CONSTRAINT "settlements_conversion_complete" CHECK (("settlements"."converted_amount" IS NULL AND "settlements"."exchange_rate" IS NULL AND "settlements"."converted_currency" IS NULL)
          OR ("settlements"."converted_amount" IS NOT NULL AND "settlements"."exchange_rate" IS NOT NULL AND "settlements"."converted_currency" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "guest_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"actor_participant_id" uuid,
	"actor_label" text,
	"action" "activity_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"description" text NOT NULL,
	"notes" text,
	"category" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate" numeric(30, 12),
	"exchange_rate_source" "exchange_rate_source",
	"payers" jsonb NOT NULL,
	"split_method" "split_method" NOT NULL,
	"split_input" jsonb NOT NULL,
	"frequency" "recurrence_frequency" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"weekday" integer,
	"day_of_month" integer,
	"month_of_year" integer,
	"timezone" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"created_by_actor_type" "actor_type" NOT NULL,
	"created_by_participant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recurring_expenses_amount_positive" CHECK ("recurring_expenses"."amount" > 0),
	CONSTRAINT "recurring_expenses_interval_positive" CHECK ("recurring_expenses"."interval" >= 1),
	CONSTRAINT "recurring_expenses_weekday_range" CHECK ("recurring_expenses"."weekday" IS NULL OR ("recurring_expenses"."weekday" BETWEEN 1 AND 7)),
	CONSTRAINT "recurring_expenses_day_of_month_range" CHECK ("recurring_expenses"."day_of_month" IS NULL OR ("recurring_expenses"."day_of_month" BETWEEN 1 AND 31)),
	CONSTRAINT "recurring_expenses_month_range" CHECK ("recurring_expenses"."month_of_year" IS NULL OR ("recurring_expenses"."month_of_year" BETWEEN 1 AND 12)),
	CONSTRAINT "recurring_expenses_end_after_start" CHECK ("recurring_expenses"."end_date" IS NULL OR "recurring_expenses"."end_date" >= "recurring_expenses"."start_date")
);
--> statement-breakpoint
CREATE TABLE "recurring_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurring_expense_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"expense_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"expense_id" uuid,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"checksum" text NOT NULL,
	"uploaded_by_participant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_run_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"kind" "import_row_kind" NOT NULL,
	"status" "import_row_status" DEFAULT 'pending' NOT NULL,
	"staged" jsonb NOT NULL,
	"raw" jsonb,
	"fingerprint" text NOT NULL,
	"message" text,
	"created_entity_type" text,
	"created_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"source_format" "import_source_format" NOT NULL,
	"status" "import_run_status" DEFAULT 'uploaded' NOT NULL,
	"file_name" text NOT NULL,
	"file_size" bigint NOT NULL,
	"file_checksum" text NOT NULL,
	"summary" jsonb,
	"warnings" jsonb,
	"participant_mapping" jsonb,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"rows_failed" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "imported_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payers" ADD CONSTRAINT "expense_payers_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payers" ADD CONSTRAINT "expense_payers_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_participant_id_participants_id_fk" FOREIGN KEY ("created_by_participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_participant_id_participants_id_fk" FOREIGN KEY ("from_participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_participant_id_participants_id_fk" FOREIGN KEY ("to_participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_participant_id_participants_id_fk" FOREIGN KEY ("created_by_participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_invitations" ADD CONSTRAINT "guest_invitations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_invitations" ADD CONSTRAINT "guest_invitations_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_invitations" ADD CONSTRAINT "guest_invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_invitation_id_guest_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."guest_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_participant_id_participants_id_fk" FOREIGN KEY ("actor_participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_created_by_participant_id_participants_id_fk" FOREIGN KEY ("created_by_participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_participant_id_participants_id_fk" FOREIGN KEY ("uploaded_by_participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_fingerprints" ADD CONSTRAINT "imported_fingerprints_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_fingerprints" ADD CONSTRAINT "imported_fingerprints_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_id_unique" ON "passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_hash_unique" ON "verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_tokens_user_idx" ON "verification_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_challenges_challenge_unique" ON "webauthn_challenges" USING btree ("challenge");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_expires_idx" ON "webauthn_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_user_unique" ON "group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "group_members_group_idx" ON "group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "groups_created_by_idx" ON "groups" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "participants_group_idx" ON "participants" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_group_user_unique" ON "participants" USING btree ("group_id","user_id") WHERE "participants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "participants_user_idx" ON "participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_payers_expense_participant_unique" ON "expense_payers" USING btree ("expense_id","participant_id");--> statement-breakpoint
CREATE INDEX "expense_payers_participant_idx" ON "expense_payers" USING btree ("participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_shares_expense_participant_unique" ON "expense_shares" USING btree ("expense_id","participant_id");--> statement-breakpoint
CREATE INDEX "expense_shares_participant_idx" ON "expense_shares" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "expenses_group_date_idx" ON "expenses" USING btree ("group_id","expense_date" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expenses_group_active_idx" ON "expenses" USING btree ("group_id") WHERE "expenses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "expenses_recurring_idx" ON "expenses" USING btree ("recurring_expense_id");--> statement-breakpoint
CREATE INDEX "settlements_group_date_idx" ON "settlements" USING btree ("group_id","settled_on" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "settlements_group_active_idx" ON "settlements" USING btree ("group_id") WHERE "settlements"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "settlements_from_idx" ON "settlements" USING btree ("from_participant_id");--> statement-breakpoint
CREATE INDEX "settlements_to_idx" ON "settlements" USING btree ("to_participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_invitations_token_hash_unique" ON "guest_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_invitations_group_idx" ON "guest_invitations" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_invitations_active_participant_unique" ON "guest_invitations" USING btree ("participant_id") WHERE "guest_invitations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_sessions_token_hash_unique" ON "guest_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_sessions_invitation_idx" ON "guest_sessions" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "guest_sessions_group_idx" ON "guest_sessions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "guest_sessions_expires_idx" ON "guest_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_bucket_window_unique" ON "rate_limits" USING btree ("bucket","window_start");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "activity_events_group_created_idx" ON "activity_events" USING btree ("group_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_entity_idx" ON "activity_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_group_idx" ON "recurring_expenses" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_due_idx" ON "recurring_expenses" USING btree ("next_run_at") WHERE "recurring_expenses"."deleted_at" IS NULL AND "recurring_expenses"."paused_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_occurrences_template_date_unique" ON "recurring_occurrences" USING btree ("recurring_expense_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "recurring_occurrences_expense_idx" ON "recurring_occurrences" USING btree ("expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_storage_key_unique" ON "attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "attachments_expense_idx" ON "attachments" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "attachments_group_idx" ON "attachments" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "attachments_orphan_idx" ON "attachments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "import_rows_run_idx" ON "import_rows" USING btree ("import_run_id","row_number");--> statement-breakpoint
CREATE INDEX "import_rows_status_idx" ON "import_rows" USING btree ("import_run_id","status");--> statement-breakpoint
CREATE INDEX "import_rows_group_fingerprint_idx" ON "import_rows" USING btree ("group_id","fingerprint");--> statement-breakpoint
CREATE INDEX "import_runs_group_idx" ON "import_runs" USING btree ("group_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_runs_status_idx" ON "import_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "imported_fingerprints_group_fingerprint_unique" ON "imported_fingerprints" USING btree ("group_id","fingerprint");