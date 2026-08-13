CREATE TYPE "public"."reminder_channel" AS ENUM('push', 'share');--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'reminder.sent';--> statement-breakpoint
ALTER TYPE "public"."notification_category" ADD VALUE 'reminders';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'reminder.received';--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"from_participant_id" uuid NOT NULL,
	"to_participant_id" uuid NOT NULL,
	"channel" "reminder_channel" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "last_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "reminders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_from_participant_id_participants_id_fk" FOREIGN KEY ("from_participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_to_participant_id_participants_id_fk" FOREIGN KEY ("to_participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_pair_idx" ON "reminders" USING btree ("group_id","from_participant_id","to_participant_id","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reminders_group_idx" ON "reminders" USING btree ("group_id","sent_at" DESC NULLS LAST);