import { createHash, timingSafeEqual } from "node:crypto";

/**
 * PKCE (RFC 7636), `S256` only.
 *
 * The code an application is handed can travel through places it does not
 * control — a browser history, a log, an operating system's URL handler. PKCE
 * is what makes the code useless to anybody but the application that asked: it
 * committed to a hash of a secret before the person was sent anywhere, and has
 * to produce the secret to spend the code.
 *
 * It is required for every client rather than only public ones, because every
 * client here is public.
 */

/** The verifier: 43–128 characters from the unreserved set (RFC 7636 §4.1). */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/** The challenge: the unpadded base64url of a SHA-256, which is 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && VERIFIER.test(value);
}

export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && CHALLENGE.test(value);
}

/** The challenge a verifier produces. Exported for the tests. */
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Whether `verifier` is the one `challenge` was made from. */
export function verifyCodeChallenge(
  verifier: unknown,
  challenge: string,
): boolean {
  if (!isValidCodeVerifier(verifier)) return false;
  const expected = Buffer.from(challenge, "utf8");
  const actual = Buffer.from(challengeFor(verifier), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
