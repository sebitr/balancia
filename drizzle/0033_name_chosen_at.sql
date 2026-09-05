ALTER TABLE "webauthn_challenges" DROP CONSTRAINT "webauthn_challenges_signup_complete";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name_chosen_at" timestamp with time zone;--> statement-breakpoint
--
-- Every account that existed before the stamp, judged once by the evidence
-- the dashboard used to weigh on every render: a name that is not byte for
-- byte the local part of its address was typed by somebody, because the two
-- signups that derive one write that local part exactly and addresses are
-- stored lowercased. Doing it here rather than at render time is what lets a
-- reader called Seb at seb@ keep their name and lose the card, and it costs
-- only the accounts genuinely stuck on a placeholder that happens to match
-- their own capitalisation — who are asked once more, and stamped the moment
-- they save a name.
--
UPDATE "users" SET "name_chosen_at" = "created_at" WHERE "name" <> split_part("email", '@', 1);--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_signup_name_scope" CHECK ("webauthn_challenges"."kind" = 'signup' OR "webauthn_challenges"."signup_name" IS NULL);--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_signup_complete" CHECK (("webauthn_challenges"."kind" = 'signup') = ("webauthn_challenges"."signup_email" IS NOT NULL AND "webauthn_challenges"."user_handle" IS NOT NULL));
