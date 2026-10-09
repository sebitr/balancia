import { z } from "zod";
import { getEnv } from "@/lib/env";
import { trackRoute } from "@/lib/metrics/http";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getClient } from "@/modules/agent-access/clients";
import { OAuthError } from "@/modules/agent-access/errors";
import {
  exchangeAuthorizationCode,
  refreshGrant,
  type IssuedTokens,
} from "@/modules/agent-access/grants";
import { scopeString } from "@/modules/agent-access/scopes";
import {
  agentAccessOff,
  oauthErrorResponse,
  oauthJson,
  readParameters,
  required,
  single,
} from "../support";

/**
 * The token endpoint (RFC 6749 §3.2): `POST /oauth/token`.
 *
 * Two grants, and no others. `authorization_code` turns the code a person's
 * "Allow" produced into a pair of tokens, with PKCE standing in for a client
 * secret. `refresh_token` replaces a pair with the next one, once. There is no
 * `password` grant and no `client_credentials`: the first hands the account's
 * password to software, and the second would issue access with nobody having
 * said yes.
 *
 * Clients are public — they authenticate with `client_id` alone, because there
 * is nothing they could keep secret — so the checks that matter are the ones
 * on the *code*: it is single-use, bound to the client and address that asked,
 * and unusable without the verifier whose hash was committed to up front.
 */

const uuid = z.uuid();

export async function POST(request: Request) {
  return trackRoute("/oauth/token", "POST", () => handle(request));
}

async function handle(request: Request): Promise<Response> {
  const off = agentAccessOff();
  if (off) return off;

  try {
    const params = await readParameters(request);
    if (!params) {
      throw new OAuthError(
        "invalid_request",
        "Send application/x-www-form-urlencoded parameters.",
      );
    }

    const clientId = required(params, "client_id");
    // Before the limiter, and against the table: an id that merely looks like a
    // UUID would otherwise mint a rate-limit row per guess, which is a way to
    // grow `rate_limits` without limit from outside.
    if (
      !uuid.safeParse(clientId).success ||
      (await getClient(clientId)) === null
    ) {
      throw new OAuthError("invalid_client", "Unknown client.");
    }
    // Per client *and* per address. A client id is not a secret — it is in the
    // authorize URL, so in browser history and proxy logs — and keyed by it alone
    // anybody who has seen one could spend its allowance and stop that
    // connection refreshing. The hosted clients call from their own addresses,
    // so a stranger's address has a bucket of its own to spend.
    const limit = await consumeRateLimit(
      "agentToken",
      `${clientId}:${await getClientIp()}`,
    );
    if (!limit.allowed) {
      return oauthJson(
        {
          error: "invalid_request",
          error_description: "Too many requests. Slow down.",
        },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    const origin = getEnv().appOrigin;
    const resource = single(params, "resource");
    const grantType = required(params, "grant_type");

    let issued: IssuedTokens;
    if (grantType === "authorization_code") {
      issued = await exchangeAuthorizationCode(
        {
          code: required(params, "code"),
          clientId,
          redirectUri: required(params, "redirect_uri"),
          codeVerifier: required(params, "code_verifier"),
          ...(resource === undefined ? {} : { resource }),
        },
        origin,
      );
    } else if (grantType === "refresh_token") {
      const scope = single(params, "scope");
      issued = await refreshGrant(
        {
          refreshToken: required(params, "refresh_token"),
          clientId,
          ...(scope === undefined ? {} : { scope }),
          ...(resource === undefined ? {} : { resource }),
        },
        origin,
      );
    } else {
      throw new OAuthError(
        "unsupported_grant_type",
        "Supported grant types: authorization_code, refresh_token.",
      );
    }

    return oauthJson({
      access_token: issued.accessToken,
      token_type: "Bearer",
      expires_in: issued.expiresIn,
      refresh_token: issued.refreshToken,
      scope: scopeString(issued.scope),
    });
  } catch (error) {
    return oauthErrorResponse(error, "/oauth/token");
  }
}
