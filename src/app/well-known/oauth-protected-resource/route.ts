import { getEnv } from "@/lib/env";
import { protectedResourceMetadata } from "@/modules/agent-access/metadata";

/**
 * Protected resource metadata (RFC 9728), served at
 * `/.well-known/oauth-protected-resource` and, by the rewrite in
 * `next.config.ts`, at `/.well-known/oauth-protected-resource/mcp` — the
 * spelling RFC 9728 gives a resource that has a path, which a client tries
 * first.
 *
 * It is the first thing a client reads after its first `401`, and it answers
 * one question: who vouches for `/mcp`. The answer is this server itself.
 *
 * The same bytes for everybody and nothing in them that is not already public,
 * so it is cacheable and open to any origin; a browser-based client has to be
 * able to read it. See the AASA route beside it for why this file is not
 * under a dot-prefixed folder.
 */
export function GET(): Response {
  if (!getEnv().agentAccessEnabled) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json(protectedResourceMetadata(getEnv().appOrigin), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
