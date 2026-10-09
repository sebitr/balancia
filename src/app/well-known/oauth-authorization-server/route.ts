import { getEnv } from "@/lib/env";
import { authorizationServerMetadata } from "@/modules/agent-access/metadata";

/**
 * Authorization server metadata (RFC 8414), served at
 * `/.well-known/oauth-authorization-server`.
 *
 * Where a client learns the addresses of the authorize, token, registration and
 * revocation endpoints, and — as importantly — what this server does *not* do:
 * no client secrets, no `plain` PKCE, no grants but the two. A client that
 * reads that and has nothing in common with it fails at the start, which is
 * kinder than failing at the token endpoint.
 *
 * The issuer is the instance's `APP_URL`, never the request's `Host`; see
 * `metadata.ts`.
 */
export function GET(): Response {
  if (!getEnv().agentAccessEnabled) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json(authorizationServerMetadata(getEnv().appOrigin), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
