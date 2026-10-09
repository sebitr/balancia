import "server-only";
import { getEnv } from "@/lib/env";
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

/** The `Content-Length` the sender declared, or 0 when it sent none. */
export function declaredLength(request: Request): number {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  return Number.isFinite(declared) ? declared : 0;
}

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

  // A body that announces itself as large is refused without being read.
  if (declaredLength(request) > MAX_BODY_BYTES) return null;

  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > MAX_BODY_BYTES) return null;

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
