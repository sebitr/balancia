import { OAUTH_AUTHORIZE_PATH } from "./constants";

/**
 * Where signing in sends a person afterwards.
 *
 * Almost always the dashboard, and the sign-in page has never honoured a
 * `next` in the address. One screen needs it to: the consent page for an AI
 * agent. Somebody who adds Balancia to Claude while signed out is sent to
 * sign in, and landing on the dashboard afterwards would strand the connection
 * they were in the middle of — the agent is waiting for an answer that nobody
 * will ever give it.
 *
 * So this honours `next` for that one path and refuses everything else. A
 * return address accepted from the address bar is an open redirect waiting for
 * somebody to write to it, and a general one would be exactly that; an
 * allowlist of a single path, with the query kept as given, is not. The query
 * is the authorization request, which the consent page validates in full
 * before it shows anything.
 */
const DEFAULT_DESTINATION = "/dashboard";

const HOST = "http://return.invalid";

export function signInDestination(next: unknown): string {
  if (typeof next !== "string") return DEFAULT_DESTINATION;
  if (!next.startsWith(`${OAUTH_AUTHORIZE_PATH}?`)) return DEFAULT_DESTINATION;
  if (next.length > 4096) return DEFAULT_DESTINATION;
  // The parser drops tabs and newlines before it reads anything, and treats a
  // backslash as a slash; none belongs in an address the app wrote.
  if (/[\\\s\p{Cc}]/u.test(next)) return DEFAULT_DESTINATION;

  let url: URL;
  try {
    url = new URL(next, HOST);
  } catch {
    return DEFAULT_DESTINATION;
  }
  if (url.origin !== HOST || url.pathname !== OAUTH_AUTHORIZE_PATH) {
    return DEFAULT_DESTINATION;
  }
  return `${url.pathname}${url.search}`;
}
