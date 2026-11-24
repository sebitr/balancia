import "server-only";
import { getEnv } from "@/lib/env";
import { readRequestText } from "@/lib/http/read-capped";
import { logger } from "@/lib/logger";
import { OAuthError } from "@/modules/agent-access/errors";

/**
 * What the three machine endpoints — `/oauth/token`, `/oauth/register`,
 * `/oauth/revoke` — share: how they answer, and how they read.
 *
 * Every answer is `Cache-Control: no-store` and `Pragma: no-cache`, which RFC
 * 6749 §5.1 requires of anything carrying a token and which costs nothing on
 * the rest. Every body is JSON, including the errors, in the shape §5.2 gives:
 * `{error, error_description}`. A client branches on `error`; the description
 * is for a person reading a log.
 */

const HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

/** What any of these endpoints reads: a handful of short parameters. */
export const MAX_BODY_BYTES = 16_384;

export function oauthJson(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return Response.json(body, { status, headers: { ...HEADERS, ...extra } });
}

/** The endpoints answer 404 on an instance that has agent access switched off. */
export function agentAccessOff(): Response | null {
  return getEnv().agentAccessEnabled
    ? null
    : oauthJson({ error: "not_found" }, 404);
}

export function oauthErrorResponse(error: unknown, endpoint: string): Response {
  if (error instanceof OAuthError) {
    return oauthJson(
      { error: error.code, error_description: error.message },
      error.status,
    );
  }
  logger.error({ err: error }, `${endpoint} failed`);
  return oauthJson(
    { error: "server_error", error_description: "Something went wrong." },
    500,
  );
}

/**
 * The parameters of a token or revocation request.
 *
 * RFC 6749 §3.2 wants `application/x-www-form-urlencoded`, and that is what
 * Claude and ChatGPT send. A JSON body is accepted as well, for the client
 * library that sends one, and read into the same shape. Anything else — most
 * importantly `multipart/form-data`, which would make the parse a file upload
 * — is refused rather than guessed at.
 */
export async function readParameters(
  request: Request,
): Promise<URLSearchParams | null> {
  const type = (request.headers.get("Content-Type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  // Refused before a byte of it is read: there is no reason to take in a body
  // that nothing here would parse.
  if (
    type !== "application/x-www-form-urlencoded" &&
    type !== "application/json"
  ) {
    return null;
  }

  // Counted as it is read, not trusted from the header: a chunked body declares
  // no length at all, and `request.text()` would buffer all of it first.
  let text: string | null;
  try {
    text = await readRequestText(request, MAX_BODY_BYTES);
  } catch {
    return null;
  }
  if (text === null) return null;

  if (type === "application/x-www-form-urlencoded") {
    return new URLSearchParams(text);
  }
  if (type === "application/json") {
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(parsed)) {
        if (typeof value === "string") params.set(name, value);
      }
      return params;
    } catch {
      return null;
    }
  }
  return null;
}

/** One value, or `undefined` — and a repeated parameter is a refused request. */
export function single(
  params: URLSearchParams,
  name: string,
): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) {
    throw new OAuthError("invalid_request", `${name} must not be repeated.`);
  }
  const value = values[0];
  return value === undefined || value === "" ? undefined : value;
}

export function required(params: URLSearchParams, name: string): string {
  const value = single(params, name);
  if (value === undefined) {
    throw new OAuthError("invalid_request", `${name} is required.`);
  }
  return value;
}
