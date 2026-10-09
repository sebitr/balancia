import { randomBytes } from "node:crypto";
import { hashToken, type GeneratedToken } from "@/lib/security/tokens";

/**
 * The three secrets of the authorization flow, and how each announces itself.
 *
 * All three are 256 bits of CSPRNG output, base64url, and only the SHA-256 is
 * ever stored — the rules `lib/security/tokens.ts` sets for every opaque token.
 *
 * The access and refresh tokens carry a prefix, for the reason an API key does:
 * they are pasted, logged and pushed into other people's systems, and a
 * secret scanner has to be able to recognise one before it leaks rather than
 * after. The prefixes also keep the three credential kinds from being mistaken
 * for one another: `blc_` is an API key, `bla_` an access token, `blr_` a
 * refresh token, and each is looked up in its own table.
 */

export const ACCESS_TOKEN_PREFIX = "bla_";
export const REFRESH_TOKEN_PREFIX = "blr_";

const BYTES = 32;

function withPrefix(prefix: string): GeneratedToken {
  const raw = prefix + randomBytes(BYTES).toString("base64url");
  return { raw, hash: hashToken(raw), prefix: raw.slice(0, prefix.length + 8) };
}

export function generateAccessToken(): GeneratedToken {
  return withPrefix(ACCESS_TOKEN_PREFIX);
}

export function generateRefreshToken(): GeneratedToken {
  return withPrefix(REFRESH_TOKEN_PREFIX);
}

/** The authorization code is never shown to a person, so it needs no prefix. */
export function generateAuthorizationCode(): GeneratedToken {
  return withPrefix("");
}

/**
 * Shape checks, run before a query so garbage costs a regex and not a lookup.
 * They accept what is minted and no more, in the direction that matters: a
 * bearer header is attacker-supplied.
 */
export function isWellFormedAccessToken(candidate: string): boolean {
  return /^bla_[A-Za-z0-9_-]{43}$/.test(candidate);
}

export function isWellFormedRefreshToken(candidate: string): boolean {
  return /^blr_[A-Za-z0-9_-]{43}$/.test(candidate);
}

export function isWellFormedAuthorizationCode(candidate: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(candidate);
}
