/**
 * The shape of a six-digit code, with nothing secret in it.
 *
 * Separate from `codes.ts` because the boxes that collect a code run in the
 * browser and the digest that checks one does not: importing the length and
 * the tidy-up from a module that opens `node:crypto` would put a Node
 * built-in in the client bundle to learn the number six.
 */

/** Six digits: long enough with a rate limit, short enough to retype. */
export const CODE_LENGTH = 6;

/**
 * Digits only, capped at six.
 *
 * People paste codes with spaces in them, and iOS offers them from the
 * keyboard with the surrounding sentence sometimes coming along. Everything
 * that is not a digit is dropped rather than rejected, so a correct code typed
 * untidily still works.
 */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

export function isWellFormedCode(candidate: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(candidate);
}
