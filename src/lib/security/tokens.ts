import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque token generation and verification.
 *
 * Used for guest invitation links and guest session cookies. The rules:
 *
 *  - 256 bits of cryptographically secure entropy, base64url encoded.
 *  - Only the SHA-256 hash is ever persisted, so a database leak yields no
 *    working links.
 *  - Lookups are by hash (indexed, constant work), and any secondary
 *    comparison is timing-safe.
 *  - The raw token never enters a log line, an activity event or a URL that
 *    outlives the redemption redirect.
 */

/** 32 bytes = 256 bits. */
const TOKEN_BYTES = 32;

/** Characters kept for "link ending in …" display. Not secret on its own. */
const PREFIX_LENGTH = 8;

export interface GeneratedToken {
  /** Shown to the creator once, then forgotten by the server. */
  readonly raw: string;
  /** Stored. */
  readonly hash: string;
  /** Stored, for identifying a link in the UI without revealing it. */
  readonly prefix: string;
}

export function generateToken(): GeneratedToken {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    raw,
    hash: hashToken(raw),
    prefix: raw.slice(0, PREFIX_LENGTH),
  };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex hashes. Lookup is normally by indexed
 * hash equality; this exists for the paths where a candidate must be compared
 * against a value already in memory.
 */
export function tokensMatch(hashA: string, hashB: string): boolean {
  const bufferA = Buffer.from(hashA, "hex");
  const bufferB = Buffer.from(hashB, "hex");
  if (bufferA.length !== bufferB.length || bufferA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Rejects obviously malformed tokens before touching the database, so garbage
 * input costs a regex rather than a query.
 */
export function isWellFormedToken(candidate: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(candidate);
}
