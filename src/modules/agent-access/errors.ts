/**
 * The refusals of the authorization endpoints, in the vocabulary RFC 6749
 * §5.2 and RFC 7591 §3.2.2 give them.
 *
 * A client branches on `code`, never on the sentence, so the codes are the
 * contract and the descriptions are for whoever is reading a log. They are in
 * English and say what was wrong with the request, not what is true of the
 * server: `invalid_grant` is the one answer for an unknown, spent, expired or
 * foreign code, because telling those apart would say which codes have ever
 * existed.
 */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "invalid_scope"
  | "invalid_target"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "access_denied"
  | "server_error";

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  /** The HTTP status a token-style endpoint answers with. */
  readonly status: number;

  constructor(code: OAuthErrorCode, description: string, status?: number) {
    super(description);
    this.name = "OAuthError";
    this.code = code;
    this.status = status ?? (code === "invalid_client" ? 401 : 400);
  }
}
