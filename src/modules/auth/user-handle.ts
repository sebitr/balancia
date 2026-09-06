import { randomBytes } from "node:crypto";

/**
 * Mints an account's WebAuthn user handle.
 *
 * Its own module because two callers need the same value and neither can own
 * it: the `users` schema mints one for every row inserted, and the passkey
 * signup ceremony has to commit to one *before* there is a row to put it on —
 * the authenticator is told the handle at the moment the credential is
 * created, which is seconds before the account exists.
 *
 * No `server-only` here, unlike the rest of this module's neighbours: the
 * schema imports it, and drizzle-kit loads the schema in plain Node where that
 * marker throws.
 *
 * Thirty-two random bytes rather than the row id, because this value leaves
 * the server: a password manager keeps it for as long as the passkey lives,
 * and an opaque handle is what the spec asks for in place of anything that
 * identifies the account elsewhere.
 */
export function mintWebauthnUserHandle(): string {
  return randomBytes(32).toString("base64url");
}
