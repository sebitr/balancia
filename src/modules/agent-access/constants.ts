/**
 * The numbers and addresses the agent-access feature is built on, in one place.
 *
 * Pure on purpose — no database, no request — so the authorization server, the
 * MCP endpoint, the settings screen and the tests all read the same values and
 * none of them restates one.
 */

/** Where the MCP endpoint lives. The OAuth `resource` is its absolute form. */
export const MCP_PATH = "/mcp";

export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";
export const OAUTH_DECISION_PATH = "/oauth/authorize/decision";
export const OAUTH_TOKEN_PATH = "/oauth/token";
export const OAUTH_REGISTER_PATH = "/oauth/register";
export const OAUTH_REVOKE_PATH = "/oauth/revoke";

/** The two discovery documents, at the paths RFC 9728 and RFC 8414 give them. */
export const PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";
export const AUTHORIZATION_SERVER_METADATA_PATH =
  "/.well-known/oauth-authorization-server";

/**
 * How long an access token lives.
 *
 * An hour is the usual answer and the reason is the same everywhere: the token
 * sits in a vendor's server, and what a copy of it is worth is bounded by how
 * long it works. The refresh token is how a client carries on, and that one
 * moves every time it is used.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * How long an unused grant stays alive: the refresh token's life, counted from
 * the last time it was spent. A connection nobody has used for three months
 * ends by itself; one that is used never does.
 */
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

/** From "Allow" to the client exchanging the code. Minutes, not an hour. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;

/** How long a consent screen stays valid once it has been drawn. */
export const CONSENT_TTL_SECONDS = 10 * 60;

/**
 * After a refresh token has been replaced, the old one is forgiven this long.
 *
 * Two requests that leave together — a proactive refresh and a reactive one,
 * say — both carry the same token, and whichever arrives second is not a thief.
 * Past this window a replaced token coming back is treated as stolen.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 10;

/** Applications one account can have connected at once. */
export const MAX_LIVE_GRANTS = 25;

/** An unauthenticated registration that no person ever reached a screen for. */
export const UNUSED_CLIENT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Registrations nobody has allowed that are kept at once. Far more than any
 * instance sees connectors added in a week, and few enough that a flood fills
 * a table of a few thousand small rows rather than the disk.
 */
export const MAX_UNUSED_CLIENTS = 2000;

/** A spent or lapsed code is kept this long, for the replay it can still catch. */
export const SPENT_CODE_RETENTION_SECONDS = 24 * 60 * 60;

export const CLIENT_NAME_MAX_LENGTH = 100;
export const REDIRECT_URIS_MAX = 5;
export const REDIRECT_URI_MAX_LENGTH = 2048;

/** The only code challenge method. `plain` protects nothing and is not offered. */
export const CODE_CHALLENGE_METHOD = "S256";

/** What an application is called when it did not say. */
export const UNNAMED_CLIENT = "Unnamed application";
