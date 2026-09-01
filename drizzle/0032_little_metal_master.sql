CREATE TABLE "proof_of_work_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce" text NOT NULL,
	"answer_hash" text NOT NULL,
	"max_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "proof_of_work_challenges_nonce_unique" ON "proof_of_work_challenges" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "proof_of_work_challenges_expires_idx" ON "proof_of_work_challenges" USING btree ("expires_at");