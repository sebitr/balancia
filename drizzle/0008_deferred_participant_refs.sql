--
-- Let a group be deleted without letting a participant vanish from an expense.
--
-- These four references were ON DELETE restrict. Postgres checks `restrict`
-- immediately, in the middle of the statement, and — unlike `no action` — it
-- fires even when the referencing rows are themselves queued for deletion by
-- the same statement. Deleting a group cascades to participants and to
-- expenses in one statement, so the participant leg raised
--
--   update or delete on table "participants" violates RESTRICT setting of
--   foreign key constraint "expense_payers_participant_id_participants_id_fk"
--
-- before the expense leg had removed the payers and shares. Every group that
-- had ever recorded an expense or a settlement was undeletable.
--
-- `no action` alone is not enough: its check is queued as an after-row trigger
-- and still runs ahead of the cascade that clears expense_payers. Deferring to
-- commit time is what actually fixes it, and it is the stronger statement of
-- intent anyway — the rule was never "these rows pin a participant forever",
-- it was "no transaction may end with an expense naming someone who is gone".
--
-- Drizzle cannot express DEFERRABLE, so this file is maintained by hand.
--
ALTER TABLE "expense_payers" DROP CONSTRAINT "expense_payers_participant_id_participants_id_fk";
--> statement-breakpoint
ALTER TABLE "expense_shares" DROP CONSTRAINT "expense_shares_participant_id_participants_id_fk";
--> statement-breakpoint
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_from_participant_id_participants_id_fk";
--> statement-breakpoint
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_to_participant_id_participants_id_fk";
--> statement-breakpoint
ALTER TABLE "expense_payers" ADD CONSTRAINT "expense_payers_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_participant_id_participants_id_fk" FOREIGN KEY ("from_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_participant_id_participants_id_fk" FOREIGN KEY ("to_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
