ALTER TABLE "passkeys" ADD COLUMN "user_handle" text;--> statement-breakpoint
ALTER TABLE "passkeys" ADD COLUMN "aaguid" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "webauthn_user_handle" text;--> statement-breakpoint
/*
 * Existing accounts carry their id, because that is the handle
 * `startPasskeyRegistration` has been sending all along: any passkey added
 * from the settings screen is filed under it, and minting a fresh handle here
 * would split those credentials off into a second entry in the reader's
 * password manager — the very thing this column exists to prevent.
 */
UPDATE "users" SET "webauthn_user_handle" = "id"::text WHERE "webauthn_user_handle" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "webauthn_user_handle" SET NOT NULL;--> statement-breakpoint
/*
 * `passkeys.user_handle` is deliberately *not* backfilled, and the reason is
 * worth the paragraph.
 *
 * Two kinds of row are already in this table and nothing distinguishes them:
 * one registered from the settings screen, filed under the account id, and
 * one created during a passkey signup, filed under a random handle that was
 * discarded with its challenge row. A backfill would have to guess, and the
 * cost of guessing wrong is not a cosmetic one — `signalAllAcceptedCredentials`
 * deletes every credential under a handle that the list it is given omits, so
 * a row filed under the wrong handle can talk a password manager into
 * throwing away a working passkey.
 *
 * So every existing row says "unknown" until its next sign-in, where the
 * assertion carries the authenticator's own `userHandle` and settles it. Until
 * an account's rows are all known, `reconcilePasskeyList` declines to run.
 */
CREATE UNIQUE INDEX "users_webauthn_user_handle_unique" ON "users" USING btree ("webauthn_user_handle");
