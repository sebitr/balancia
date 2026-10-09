import { trackRoute } from "@/lib/metrics/http";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { registerClient } from "@/modules/agent-access/clients";
import { OAuthError } from "@/modules/agent-access/errors";
import {
  agentAccessOff,
  declaredLength,
  MAX_BODY_BYTES,
  oauthErrorResponse,
  oauthJson,
} from "../support";

/**
 * Dynamic client registration (RFC 7591): `POST /oauth/register`.
 *
 * How a connector added by its address introduces itself. Claude and ChatGPT
 * have never met this instance, so there is no one to have issued them an id
 * beforehand; they post a name and the address they want the answer sent to,
 * and get an id back.
 *
 * **It authenticates nobody and grants nothing.** The row it writes is a
 * claim — "an application called X, reachable at Y" — and the consent screen
 * says exactly that to the person deciding, with the address in plain sight.
 * What stops it being a free write is the per-address rate limit, the cap on
 * registrations nobody has allowed, and the worker's sweep of the old ones.
 *
 * Whatever else the client asked for is ignored and the response says what it
 * got: a public client, authorization code and refresh token, no secret.
 */

export async function POST(request: Request) {
  return trackRoute("/oauth/register", "POST", () => handle(request));
}

async function handle(request: Request): Promise<Response> {
  const off = agentAccessOff();
  if (off) return off;

  try {
    const limit = await consumeRateLimit("agentRegister", await getClientIp());
    if (!limit.allowed) {
      return oauthJson(
        {
          error: "invalid_client_metadata",
          error_description: "Too many registrations. Try again later.",
        },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    let body: unknown;
    try {
      if (declaredLength(request) > MAX_BODY_BYTES)
        throw new Error("too large");
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) throw new Error("too large");
      body = JSON.parse(text);
    } catch {
      throw new OAuthError(
        "invalid_client_metadata",
        "Send the registration as a JSON object.",
      );
    }

    const client = await registerClient(body);
    return oauthJson(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  } catch (error) {
    return oauthErrorResponse(error, "/oauth/register");
  }
}
