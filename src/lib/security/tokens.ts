import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque token generation and verification.
 *
 * Used for guest invitation links and guest session cookies. The rules:
 *
 *  - 256 bits of cryptographically secure entropy, base64url encoded.
 *  - Only the SHA-256 hash is ever persisted, so a database leak yields no
 *    working links.
 *  - Lookups are by hash, which is indexed: the database compares a full
 *    32-byte digest of an unguessable value, so there is no candidate held in
 *    memory for a comparison to leak anything about.
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
 * Rejects obviously malformed tokens before touching the database, so garbage
 * input costs a regex rather than a query.
 */
export function isWellFormedToken(candidate: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(candidate);
}

/**
 * What an API token announces itself as on the wire.
 *
 * Session and guest tokens are bare base64url and indistinguishable from each
 * other, from a UUID, and from anything else of that shape — which is fine for
 * a value that only ever travels in a cookie between one browser and one
 * server. An API token is pasted into other people's software: into a
 * Shortcut, a crontab, a tablet's configuration screen, a `.env` file that
 * ends up in a repository. It has to be greppable in a log and recognisable to
 * a secret scanner before it leaks rather than after.
 */
export const API_TOKEN_PREFIX = "blc_";

/** `blc_` plus eight characters: enough to name a key, useless as a key. */
const API_TOKEN_PREFIX_LENGTH = API_TOKEN_PREFIX.length + 8;

export function generateApiToken(): GeneratedToken {
  const raw = API_TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    raw,
    hash: hashToken(raw),
    prefix: raw.slice(0, API_TOKEN_PREFIX_LENGTH),
  };
}

/**
 * A sibling of `isWellFormedToken` rather than a widening of it.
 *
 * The direction that matters is this one: a bearer header is attacker-supplied,
 * so what it accepts must be exactly what this feature mints — never a session
 * cookie, a join link or a guest invitation, all of which are bare base64url
 * and all of which `isWellFormedToken` accepts.
 *
 * The reverse overlap is left alone on purpose. `blc_` is itself valid
 * base64url, so the shared predicate accepts an API key's shape, and
 * tightening it to reject the prefix would refuse the one session token in
 * sixteen million that happens to be minted starting `blc_` — signing somebody
 * out for nothing. Nothing needs the shapes to be disjoint: every caller of
 * the shared predicate uses it as a gate in front of a hash lookup in one
 * named table, so a key offered as a cookie costs a query that finds nothing.
 * The tables are the guard; the regexes only keep garbage off them.
 */
export function isWellFormedApiToken(candidate: string): boolean {
  return /^blc_[A-Za-z0-9_-]{40,64}$/.test(candidate);
}
