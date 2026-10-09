import type { TokenScope } from "@/modules/api-tokens/scope";

/**
 * OAuth scopes, mapped onto the two an API key has.
 *
 * An agent's access is the same two axes a key's is — does it only look, or
 * does it also write, and is it held to one group — so the OAuth vocabulary is
 * those two words and nothing finer. Anything finer would be a second
 * permission system beside the group roles, and a grant cannot widen those in
 * any case.
 *
 * `write` includes `read`, as it does for a key. The wire form names both, so a
 * client that only understands "what scopes did I get" sees the truth.
 */
export const AGENT_SCOPE_READ = "balancia:read";
export const AGENT_SCOPE_WRITE = "balancia:write";

export const AGENT_SCOPES_SUPPORTED = [
  AGENT_SCOPE_READ,
  AGENT_SCOPE_WRITE,
] as const;

/** The scope as it travels: `write` carries `read` with it. */
export function scopeNames(scope: TokenScope): string[] {
  return scope === "write"
    ? [AGENT_SCOPE_READ, AGENT_SCOPE_WRITE]
    : [AGENT_SCOPE_READ];
}

/** The space-delimited form a token response and a `scope` parameter use. */
export function scopeString(scope: TokenScope): string {
  return scopeNames(scope).join(" ");
}

/**
 * The most a request is asking for.
 *
 * A request that names no scope is asking for what the server offers, which is
 * everything — the person narrows it on the consent screen, where they can see
 * what each word means. A request that names `read` alone is asking for less,
 * and it gets less: the consent screen will not offer to write. Names this
 * server does not know are ignored rather than refused, which RFC 6749 §3.3
 * allows and which is what lets a client that always sends `offline_access`
 * connect.
 */
export function requestedScope(raw: string | null | undefined): TokenScope {
  return knownScope(raw) ?? "write";
}

/**
 * The widest scope a `scope` parameter names among the ones this server knows,
 * or null when it names none — including when it names nothing at all.
 *
 * Kept apart from `requestedScope` for the refresh grant, where "nothing I
 * recognise" must not be read as a request for the maximum.
 */
export function knownScope(raw: string | null | undefined): TokenScope | null {
  const names = (raw ?? "").split(/\s+/).filter(Boolean);
  if (names.includes(AGENT_SCOPE_WRITE)) return "write";
  if (names.includes(AGENT_SCOPE_READ)) return "read";
  return null;
}

/** Whether a grant of `held` covers a request for `needed`. */
export function covers(held: TokenScope, needed: TokenScope): boolean {
  return held === "write" || needed === "read";
}
