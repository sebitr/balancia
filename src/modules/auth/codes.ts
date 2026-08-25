import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/**
 * The six-digit codes mailed for verification and for passwordless sign-in.
 *
 * A link token carries 256 bits and can therefore be looked up by its own
 * hash: nothing else in the table will ever collide with it, and nobody will
 * ever guess one. A six-digit code carries under twenty, which changes every
 * rule around it:
 *
 *  - **It is never a lookup key.** The account is established first — by the
 *    session, or by the address the code was mailed to — and the code is then
 *    checked against that account's live token and no other. `codeHash` mixes
 *    the account id into the digest so that a global lookup by the hash of
 *    `000000` cannot match anybody's row even by accident.
 *  - **Attempts are rate limited**, because a million guesses is not a large
 *    number and the whole security of the code is that nobody gets to make
 *    them.
 *  - **It is short-lived and single-use**, enforced by the same
 *    `verification_tokens` machinery as the links.
 *
 * This module is deliberately free of database and request imports so the
 * digits, the digest and the parsing can be tested on their own.
 */

/** Six digits: long enough with a rate limit, short enough to retype. */
const CODE_LENGTH = 6;

/**
 * A uniformly random six-digit code, leading zeros kept.
 *
 * `randomInt` is rejection-sampled by Node, so no digit is likelier than any
 * other — a modulo of a random byte string would quietly favour the low end.
 */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/**
 * What is stored for a code: SHA-256 of the account id and the digits.
 *
 * The account id is a pepper, not a secret — it makes the digest unique to one
 * row, so the stored value is useless to anyone reading the table and cannot
 * be reached by a path that knows only the digits.
 */
export function codeHash(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`, "utf8").digest("hex");
}

/**
 * Digits only, capped at six.
 *
 * People paste codes with spaces in them, and iOS offers them from the
 * keyboard with the surrounding sentence sometimes coming along. Everything
 * that is not a digit is dropped rather than rejected, so a correct code
 * typed untidily still works.
 */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

export function isWellFormedCode(candidate: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(candidate);
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The rate limit is what actually stops guessing; this stops the reply time
 * from narrowing the search for whoever is doing it.
 */
export function codesMatch(hashA: string, hashB: string): boolean {
  const bufferA = Buffer.from(hashA, "hex");
  const bufferB = Buffer.from(hashB, "hex");
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export { CODE_LENGTH };
