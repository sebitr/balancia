import { createMcpHandler } from "@modelcontextprotocol/server";
import { bearerToken } from "@/app/api/mobile";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { bearerChallenge } from "@/modules/agent-access/metadata";
import {
  resolvePrincipal,
  toAuthInfo,
  type Principal,
} from "@/modules/agent-access/principal";
import { createBalanciaServer } from "./server";

/**
 * Balancia's Model Context Protocol endpoint: `POST /mcp`.
 *
 * This is the address a person gives Claude, ChatGPT or an editor. It speaks
 * Streamable HTTP, stateless — no session survives between two calls, so any
 * number of replicas can answer any call — and both revisions of the protocol
 * in circulation: the 2026-07-28 one, and the 2025 handshake older clients
 * still open with. The SDK's handler does the protocol; this file does the
 * gate in front of it.
 *
 * ## The gate
 *
 * Nothing reaches a tool without a bearer credential, and a request with none
 * is **refused, not welcomed**: a `401` whose `WWW-Authenticate` points at the
 * protected-resource document. That header is the first step of a client's
 * sign-in — it reads it, finds the authorization server, and sends the person
 * to Balancia to say yes. A `200` carrying the same header would be ignored,
 * which is why there is no friendlier answer.
 *
 * Two credentials open it: an OAuth access token, which a client was given
 * after a person allowed it, and an API key, which a person pasted. See
 * `principal.ts` for what they have in common and why the access token is
 * accepted here and nowhere else.
 *
 * Authentication runs for every method, GET and DELETE included. The only
 * thing a GET or DELETE can get from this server is `405`, but an unknown
 * caller is told to sign in first, as everywhere else.
 */

const handler = createMcpHandler(createBalanciaServer, {
  // The 2025 revisions are served too, per request, by the same factory.
  legacy: "stateless",
  // A single JSON body per call, which is all any tool here produces. `auto`
  // would upgrade to an event stream only if a tool sent a progress message
  // before its result, and none does — so a reverse proxy has nothing to buffer
  // or cut.
  responseMode: "auto",
  // A tool call is a few hundred bytes; this is room for a long split.
  maxRequestBodySize: 256 * 1024,
  onerror: (error) => logger.warn({ err: error }, "MCP transport error"),
});

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** Either an answer to send straight back, or who is asking. */
type Gate =
  | { readonly ok: false; readonly response: Response }
  | {
      readonly ok: true;
      readonly principal: Principal;
      readonly origin: string;
    };

const refuse = (response: Response): Gate => ({ ok: false, response });

async function gate(request: Request): Promise<Gate> {
  const env = getEnv();
  if (!env.agentAccessEnabled) {
    return refuse(Response.json({ error: "Not found." }, { status: 404 }));
  }

  const challenge = (
    options: Parameters<typeof bearerChallenge>[1] = {},
  ): Response =>
    Response.json(
      { error: "Sign in to continue." },
      {
        status: 401,
        headers: {
          ...NO_STORE,
          "WWW-Authenticate": bearerChallenge(env.appOrigin, options),
        },
      },
    );

  const bearer = bearerToken(request);
  if (bearer === null || bearer === "") return refuse(challenge());

  const principal = await resolvePrincipal(bearer);
  if (!principal) {
    return refuse(
      challenge({
        error: "invalid_token",
        description: "The access token is invalid, expired or revoked.",
      }),
    );
  }

  const limit = await consumeRateLimit("apiToken", principal.credentialId);
  if (!limit.allowed) {
    return refuse(
      Response.json(
        { error: "Too many requests. Slow down." },
        {
          status: 429,
          headers: {
            ...NO_STORE,
            "Retry-After": String(limit.retryAfterSeconds),
          },
        },
      ),
    );
  }

  return { ok: true, principal, origin: env.appOrigin };
}

/** The most a call's body may be: what the handler below is told to read. */
const MAX_BODY_BYTES = 256 * 1024;

function rpcError(status: number, code: number, message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code, message } },
    { status, headers: NO_STORE },
  );
}

/**
 * A response if the body is a batch, or declares itself too large to read.
 *
 * Read from a clone, so the handler still has the original to read for itself.
 * The size is checked from the header first, so a body that announces itself as
 * large is refused without being read; one that does not announce itself is
 * bounded by the handler's own limit.
 */
async function refuseBatchOrOversize(
  request: Request,
): Promise<Response | null> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return rpcError(413, -32600, "That request is too large.");
  }
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => undefined);
  return Array.isArray(body)
    ? rpcError(
        400,
        -32600,
        "Batch requests are not supported. Send one call per request.",
      )
    : null;
}

async function handle(request: Request): Promise<Response> {
  const result = await gate(request);
  if (!result.ok) return result.response;

  if (request.method !== "POST") {
    return Response.json(
      { error: "Send MCP requests with POST." },
      { status: 405, headers: { ...NO_STORE, Allow: "POST" } },
    );
  }

  // One call to a tool per request, so that the rate limit above counts what it
  // says it counts. The 2025-03-26 protocol let a body be an array of up to a
  // hundred messages, which the SDK's legacy path dispatches concurrently: a
  // credential's six hundred requests in ten minutes would become sixty thousand
  // tool calls, and a hundred identical `add_expense` calls would all pass the
  // duplicate check before any of them committed. The 2025-06-18 revision
  // dropped batching, and no client this serves still sends one.
  const refused = await refuseBatchOrOversize(request);
  if (refused) return refused;

  const answer = await handler.fetch(request, {
    authInfo: toAuthInfo(result.principal, result.origin),
  });

  // Every answer is one person's money. Rebuilt rather than mutated: a
  // `Response` out of a library is not promised to have mutable headers.
  const headers = new Headers(answer.headers);
  headers.set("Cache-Control", NO_STORE["Cache-Control"]);
  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers,
  });
}

export async function POST(request: Request) {
  return trackRoute("/mcp", "POST", () => handle(request));
}

export async function GET(request: Request) {
  return trackRoute("/mcp", "GET", () => handle(request));
}

export async function DELETE(request: Request) {
  return trackRoute("/mcp", "DELETE", () => handle(request));
}
