import { REDIRECT_URI_MAX_LENGTH } from "./constants";

/**
 * Where an authorization answer may be sent.
 *
 * The one thing a registration cannot be allowed to get wrong, because the
 * answer carries a code and the address it goes to is chosen by a stranger.
 * Everything here is the rule for what such an address may look like, and the
 * rule for when a request's address is the one that was registered.
 *
 * Three kinds are accepted, which are the three kinds clients actually use:
 *
 *  - `https://…` — a hosted application: claude.ai, chatgpt.com.
 *  - `http://localhost`, `http://127.0.0.1`, `http://[::1]` — a native
 *    application listening on its own machine (RFC 8252 §7.3). The port is
 *    whatever the listener was given that run, so it does not take part in the
 *    comparison.
 *  - a private-use scheme — `cursor://…`, `com.example.app:/…` — a native
 *    application that registered itself with the operating system (RFC 8252
 *    §7.1).
 *
 * Everything else is refused: plain `http` anywhere but loopback, a fragment
 * (RFC 6749 §3.1.2), credentials in the address, and the schemes whose whole
 * use is to run or show something a stranger wrote.
 */

/** Schemes that run, render or fetch something rather than hand over a code. */
const REFUSED_SCHEMES = new Set([
  "javascript",
  "data",
  "vbscript",
  "file",
  "blob",
  "about",
  "ftp",
  "ws",
  "wss",
]);

export type RedirectUriCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

/** Whether a string is a redirect address Balancia will accept at registration. */
export function checkRedirectUri(value: unknown): RedirectUriCheck {
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, reason: "A redirect address must be a string." };
  }
  if (value.length > REDIRECT_URI_MAX_LENGTH) {
    return { ok: false, reason: "That redirect address is too long." };
  }
  // The URL parser drops tabs and newlines before it reads anything, so what
  // it accepts can differ from what was compared. None belongs in an address.
  if (/[\s\p{Cc}\\]/u.test(value)) {
    return {
      ok: false,
      reason: "That redirect address has invalid characters.",
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "That redirect address is not a valid URL." };
  }

  if (url.hash !== "" || value.includes("#")) {
    return { ok: false, reason: "A redirect address cannot have a fragment." };
  }
  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      reason: "A redirect address cannot carry credentials.",
    };
  }

  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (REFUSED_SCHEMES.has(scheme)) {
    return {
      ok: false,
      reason: "That redirect address scheme is not allowed.",
    };
  }

  if (scheme === "https") {
    return url.hostname === ""
      ? { ok: false, reason: "A redirect address needs a host." }
      : { ok: true };
  }
  if (scheme === "http") {
    return isLoopbackHost(url.hostname)
      ? { ok: true }
      : {
          ok: false,
          reason:
            "A redirect address must use https, except for a local application.",
        };
  }

  // A private-use scheme. The parser has already confirmed it is a scheme; the
  // dot or the slashes are not required, because `cursor://` has neither a dot
  // nor a registered domain and is a client people really use.
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
    return { ok: false, reason: "That redirect address scheme is not valid." };
  }
  return { ok: true };
}

function sameLoopback(registered: URL, requested: URL): boolean {
  return (
    registered.protocol === "http:" &&
    requested.protocol === "http:" &&
    isLoopbackHost(registered.hostname) &&
    registered.hostname === requested.hostname &&
    registered.pathname === requested.pathname &&
    registered.search === requested.search
  );
}

/**
 * Whether `requested` is one of the addresses the client registered.
 *
 * Exact string comparison, because that is the only comparison with nothing to
 * argue about — no pattern, no prefix, no wildcard. The single exception is a
 * loopback address, whose port is not the client's to know in advance.
 */
export function redirectUriMatches(
  registered: readonly string[],
  requested: string,
): boolean {
  // Registration refuses an unsafe address, so none should be stored. Checked
  // again here all the same, because "it cannot be in the table" is the kind
  // of sentence that stops being true the day another way in is added.
  if (!checkRedirectUri(requested).ok) return false;
  if (registered.includes(requested)) return true;

  let requestedUrl: URL;
  try {
    requestedUrl = new URL(requested);
  } catch {
    return false;
  }
  return registered.some((candidate) => {
    try {
      return sameLoopback(new URL(candidate), requestedUrl);
    } catch {
      return false;
    }
  });
}

/**
 * Where an address leads, in the words a person reads on a consent screen.
 *
 * The host for a web address, because the host is the thing a stranger cannot
 * borrow; the scheme for a native one, because that is all there is; and a
 * marker for a loopback address, since "this application is running on your
 * own computer" is the useful fact and "localhost" alone reads as safe when it
 * only means unverified.
 */
export function describeRedirect(uri: string): {
  readonly kind: "web" | "local" | "app";
  readonly label: string;
} {
  try {
    const url = new URL(uri);
    if (url.protocol === "https:") {
      return { kind: "web", label: url.host };
    }
    if (url.protocol === "http:") {
      return { kind: "local", label: url.hostname };
    }
    return { kind: "app", label: `${url.protocol}//` };
  } catch {
    return { kind: "app", label: uri.slice(0, 40) };
  }
}

/**
 * The address the answer goes to, with the parameters added.
 *
 * Built through `URL` so a registered address that already has a query keeps
 * it, and so the values are encoded rather than concatenated. A private-use
 * scheme survives the round trip: `URL` keeps what it was given.
 */
export function withParameters(
  uri: string,
  parameters: Readonly<Record<string, string | undefined>>,
): string {
  const url = new URL(uri);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  return url.toString();
}
