import { createMcpHandler } from "@modelcontextprotocol/server";
import { bearerToken } from "@/app/api/mobile";
import { getEnv } from "@/lib/env";
import { readRequestText } from "@/lib/http/read-capped";
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
  // `subscriptions/listen` holds an event stream open for as long as the client
  // likes, from a pool of 1024 shared by every caller on the instance, and any
  // valid credential — a read-only one included — may open one. Nothing here
  // publishes a change event, so there is nothing to listen for; none are let.
  maxSubscriptions: 0,
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
 * The call, with its body read once and bounded — or the answer to refuse it.
 *
 * A refusal if the body is too large or is a batch. The size is checked from the
 * header first, so a body that announces itself as large is refused without
 * being read, and then counted as it arrives, because a chunked request
 * announces nothing and `request.json()` would buffer all of it before anything
 * measured it. What is handed on is a new request over the text already read:
 * the body of the original is spent.
 */
async function boundedCall(request: Request): Promise<Request | Response> {
  const text = await readRequestText(request, MAX_BODY_BYTES);
  if (text === null) {
    return rpcError(413, -32600, "That request is too large.");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Not for this function to judge: the handler answers a body that is not
    // JSON with the protocol's own parse error.
    body = undefined;
  }
  if (Array.isArray(body)) {
    return rpcError(
      400,
      -32600,
      "Batch requests are not supported. Send one call per request.",
    );
  }

  const headers = new Headers(request.headers);
  headers.delete("Transfer-Encoding");
  headers.set("Content-Length", String(new TextEncoder().encode(text).length));
  return new Request(request.url, {
    method: request.method,
    headers,
    body: text,
    // So a client that hangs up still cancels the work done for it.
    signal: request.signal,
  });
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
  const call = await boundedCall(request);
  if (call instanceof Response) return call;

  const answer = await handler.fetch(call, {
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
