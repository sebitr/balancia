import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { UserActor } from "@/lib/security/authorization";
import { resolveApiToken } from "@/modules/api-tokens/service";
import type { TokenScope } from "@/modules/api-tokens/scope";
import { resolveAccessToken } from "./grants";
import { mcpResourceUrl } from "./metadata";
import { scopeNames } from "./scopes";
import { ACCESS_TOKEN_PREFIX } from "./tokens";

/**
 * Who is on the other end of an MCP request.
 *
 * Two kinds of bearer credential open `/mcp`, and they reach it by different
 * roads. An **OAuth access token** (`bla_…`) is what Claude and ChatGPT end up
 * holding after a person clicked Allow; it lives an hour and is replaced from a
 * refresh token. An **API key** (`blc_…`) is what a person pastes into a client
 * that takes a header — Claude Code, Cursor, a script. Both mean the same thing
 * from here on: a signed-in account, narrowed to read or to read and write,
 * and optionally held to one group. That sameness is the `Principal`.
 *
 * The OAuth token is accepted here and **nowhere else**. The REST API's
 * `apiActor` knows only keys, and `/mcp` is the only door a grant opens —
 * which is what the MCP specification means by a token valid only for its own
 * resource, and what keeps a stolen access token from being replayed against a
 * route that was never meant to see one.
 */
export interface Principal {
  readonly kind: "grant" | "key";
  /** The grant's or the key's id: what a rate limit is keyed by. */
  readonly credentialId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly scope: TokenScope;
  /** The one group this credential may touch, or null for all of them. */
  readonly groupId: string | null;
  /** What the person would call it: the application's name, or "an API key". */
  readonly label: string;
  readonly expiresAt: Date | null;
}

/** The credential a bearer value names, or null if it names nothing live. */
export async function resolvePrincipal(
  bearer: string,
): Promise<Principal | null> {
  if (bearer.startsWith(ACCESS_TOKEN_PREFIX)) {
    const grant = await resolveAccessToken(bearer);
    return grant
      ? {
          kind: "grant",
          credentialId: grant.grantId,
          userId: grant.userId,
          email: grant.email,
          name: grant.name,
          scope: grant.scope,
          groupId: grant.groupId,
          label: grant.clientName,
          expiresAt: grant.expiresAt,
        }
      : null;
  }

  const key = await resolveApiToken(bearer);
  return key
    ? {
        kind: "key",
        credentialId: key.tokenId,
        userId: key.userId,
        email: key.email,
        name: key.name,
        scope: key.scope,
        groupId: key.groupId,
        label: "API key",
        expiresAt: null,
      }
    : null;
}

/**
 * The principal as the SDK carries it from the HTTP gate to a tool.
 *
 * The raw token is deliberately not in it: nothing downstream has any use for
 * the secret, and a value that is never copied cannot be logged by accident.
 */
export function toAuthInfo(principal: Principal, origin: string): AuthInfo {
  return {
    token: "",
    clientId: principal.credentialId,
    scopes: scopeNames(principal.scope),
    ...(principal.expiresAt
      ? { expiresAt: Math.floor(principal.expiresAt.getTime() / 1000) }
      : {}),
    resource: new URL(mcpResourceUrl(origin)),
    extra: { principal },
  };
}

export function principalOf(authInfo: AuthInfo | undefined): Principal | null {
  const candidate = authInfo?.extra?.principal as Principal | undefined;
  return candidate && typeof candidate.userId === "string" ? candidate : null;
}

/**
 * The actor every service call is made as.
 *
 * A user, flagged `viaApiToken` and pinned the way a pinned key is — so
 * `authorizeGroup` holds a one-group credential to its group before it fetches
 * anything, and the few routes that answer a credential with less (the
 * settle-up payout details) answer an agent the same way. The flag's name says
 * "API token" and means "arrived on a bearer credential, not a session".
 */
export function actorOf(principal: Principal): UserActor {
  return {
    kind: "user",
    userId: principal.userId,
    email: principal.email,
    name: principal.name,
    viaApiToken: true,
    ...(principal.groupId === null ? {} : { tokenGroupId: principal.groupId }),
  };
}
