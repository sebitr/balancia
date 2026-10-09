import { z } from "zod";
import { trackRoute } from "@/lib/metrics/http";
import { revokeByToken } from "@/modules/agent-access/grants";
import { OAuthError } from "@/modules/agent-access/errors";
import {
  agentAccessOff,
  oauthErrorResponse,
  oauthJson,
  readParameters,
  required,
  single,
} from "../support";

/**
 * Token revocation (RFC 7009): `POST /oauth/revoke`.
 *
 * How an application says it is finished — when a person removes the connector
 * in Claude, say. It ends the whole grant, access and refresh token together,
 * and answers `200` whether or not the token was real, so that it cannot be
 * used to ask which tokens exist.
 */

const uuid = z.uuid();

export async function POST(request: Request) {
  return trackRoute("/oauth/revoke", "POST", () => handle(request));
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
    const token = required(params, "token");
    const clientId = single(params, "client_id");
    if (clientId !== undefined && !uuid.safeParse(clientId).success) {
      throw new OAuthError("invalid_client", "Unknown client.");
    }
    await revokeByToken(token, clientId);
    return oauthJson({});
  } catch (error) {
    return oauthErrorResponse(error, "/oauth/revoke");
  }
}
