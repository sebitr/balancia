import {
  AUTHORIZATION_SERVER_METADATA_PATH,
  CODE_CHALLENGE_METHOD,
  MCP_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_REGISTER_PATH,
  OAUTH_REVOKE_PATH,
  OAUTH_TOKEN_PATH,
  PROTECTED_RESOURCE_METADATA_PATH,
} from "./constants";
import { AGENT_SCOPES_SUPPORTED } from "./scopes";

/**
 * What Balancia tells a client about itself, as data.
 *
 * Three documents and one header, and each is a promise a client's first
 * request is built on: where the protected resource is and who vouches for it
 * (RFC 9728), what the authorization server can do (RFC 8414), and the
 * `WWW-Authenticate` challenge that sends a client looking for the first.
 *
 * Built from the instance's origin and nothing else. The origin is `APP_URL`,
 * never the request's `Host`: behind a reverse proxy the request sees whatever
 * the proxy forwarded, and a metadata document that names the wrong host sends
 * a client to authorize against an address that is not this server.
 */

/** The OAuth `resource` and the address clients are given: `<origin>/mcp`. */
export function mcpResourceUrl(origin: string): string {
  return `${origin}${MCP_PATH}`;
}

/**
 * Whether a `resource` names this server's MCP endpoint (RFC 8707).
 *
 * The trailing slash is forgiven in either direction — the specification itself
 * says implementations should be lenient there — and nothing else is: a token
 * is only ever issued for the one resource it will be used at.
 */
export function isThisResource(resource: string, origin: string): boolean {
  const canonical = mcpResourceUrl(origin);
  return resource === canonical || resource === `${canonical}/`;
}

/** RFC 9728: who protects `/mcp` and what it understands. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    // The issuer is the origin itself. A client uses the first entry only.
    authorization_servers: [origin],
    scopes_supported: [...AGENT_SCOPES_SUPPORTED],
    bearer_methods_supported: ["header"],
    resource_name: "Balancia",
    resource_documentation: `${origin}/llms.txt`,
  };
}

/** RFC 8414: what the authorization endpoints are and what they accept. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${OAUTH_TOKEN_PATH}`,
    registration_endpoint: `${origin}${OAUTH_REGISTER_PATH}`,
    revocation_endpoint: `${origin}${OAUTH_REVOKE_PATH}`,
    scopes_supported: [...AGENT_SCOPES_SUPPORTED],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Public clients only: PKCE stands in for a secret, and there is no
    // `client_secret_*` to offer.
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: [CODE_CHALLENGE_METHOD],
    // RFC 9207. The authorization response carries `iss`, and a client that
    // talks to more than one server can tell whose answer it is reading.
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/llms.txt`,
  };
}

/** Where a client finds the protected resource document for `/mcp`. */
export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}${PROTECTED_RESOURCE_METADATA_PATH}`;
}

export function authorizationServerMetadataUrl(origin: string): string {
  return `${origin}${AUTHORIZATION_SERVER_METADATA_PATH}`;
}

/**
 * The `WWW-Authenticate` value of a 401 or 403 from `/mcp`.
 *
 * The 401 is what starts a client's sign-in: it reads `resource_metadata` out
 * of this header and goes looking for the authorization server. A `200` with
 * the same header would not do — Claude ignores it — so an unauthenticated
 * request is refused, not welcomed.
 *
 * Quoting: values here are server-chosen and contain no `"` or `\`, but the
 * description is passed through `quoted` anyway so a future caller cannot
 * break the header's grammar.
 */
export function bearerChallenge(
  origin: string,
  options: {
    readonly error?: "invalid_token" | "insufficient_scope";
    readonly description?: string;
    readonly scope?: string;
  } = {},
): string {
  const parts = [
    `resource_metadata=${quoted(protectedResourceMetadataUrl(origin))}`,
  ];
  if (options.scope) parts.push(`scope=${quoted(options.scope)}`);
  if (options.error) parts.push(`error=${quoted(options.error)}`);
  if (options.description) {
    parts.push(`error_description=${quoted(options.description)}`);
  }
  return `Bearer ${parts.join(", ")}`;
}

function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, "")}"`;
}
