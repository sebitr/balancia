ALTER TYPE "public"."verification_purpose" ADD VALUE 'email_verification_code';--> statement-breakpoint
ALTER TYPE "public"."verification_purpose" ADD VALUE 'sign_in_code';--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD COLUMN "signup_email" text;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD COLUMN "signup_name" text;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD COLUMN "user_handle" text;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_signup_complete" CHECK (("webauthn_challenges"."kind" = 'signup') = ("webauthn_challenges"."signup_email" IS NOT NULL AND "webauthn_challenges"."signup_name" IS NOT NULL AND "webauthn_challenges"."user_handle" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_signup_anonymous" CHECK ("webauthn_challenges"."kind" <> 'signup' OR "webauthn_challenges"."user_id" IS NULL);