/**
 * Umami, on the pages a stranger sees.
 *
 * This is not telemetry and does not go through the telemetry system. It is
 * the operator's own analytics, on their own Umami, about visitors to their
 * own landing and sign-up pages — the same category of decision as pointing
 * `SMTP_HOST` at a mail relay. Off unless configured, and `docs/telemetry.md`
 * §17 is the long version.
 *
 * The boundary is the whole design: the tracker is mounted on the public
 * surface and nowhere else. Every other page in Balancia has a group or an
 * expense identifier in its path, and a page view carries the path. There is
 * no configuration of Umami that makes `/groups/f0a42f94-…/expenses/9f63…`
 * safe to send to a third party, so the answer is not to send it — the script
 * is never on those pages at all. `umami-script.test.tsx` holds it there.
 *
 * One setting rather than two: the tracker POSTs to `/api/send` on the origin
 * it was loaded from, so the address it reports to is derived rather than
 * configured. That keeps the Content-Security-Policy and the script tag
 * describing the same host by construction.
 */

/**
 * Umami website IDs are UUIDs, and the failure when one is wrong is silent —
 * the request is accepted and the data goes nowhere anyone looks. Cheaper to
 * reject a mistyped one at startup.
 */
const WEBSITE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UmamiConfig = {
  /** Absolute URL of the tracker script. */
  scriptUrl: string;
  /** The website this instance reports as. */
  websiteId: string;
  /**
   * Origin the tracker POSTs to, derived from `scriptUrl`. This is the only
   * third-party host the Content-Security-Policy admits.
   */
  origin: string;
};

/** A localhost URL, where plain HTTP is normal and safe. */
export function isLocalhostUrl(url: URL): boolean {
  const host = url.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  );
}

/**
 * What is wrong with a candidate configuration, or null when nothing is.
 *
 * Separate from reading it so the environment schema can report the reason at
 * startup while `readUmamiConfig` stays a total function that proxy.ts can
 * call on every request.
 */
export function umamiConfigError(
  scriptUrl: string | undefined,
  websiteId: string | undefined,
): { path: "UMAMI_SCRIPT_URL" | "UMAMI_WEBSITE_ID"; message: string } | null {
  const url = scriptUrl?.trim() ?? "";
  const id = websiteId?.trim() ?? "";

  if (url === "" && id === "") return null;

  if (url === "") {
    return {
      path: "UMAMI_SCRIPT_URL",
      message:
        "UMAMI_WEBSITE_ID is set but UMAMI_SCRIPT_URL is not, so nothing would " +
        "be loaded. Set both, or neither.",
    };
  }
  if (id === "") {
    return {
      path: "UMAMI_WEBSITE_ID",
      message:
        "UMAMI_SCRIPT_URL is set but UMAMI_WEBSITE_ID is not. Umami accepts a " +
        "request without one and drops it, so this fails here instead.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      path: "UMAMI_SCRIPT_URL",
      message: `UMAMI_SCRIPT_URL must be an absolute URL, such as https://analytics.example.com/script.js (got "${url}")`,
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      path: "UMAMI_SCRIPT_URL",
      message: `UMAMI_SCRIPT_URL must be http or https (got "${parsed.protocol}")`,
    };
  }

  // A page served over HTTPS with `upgrade-insecure-requests` would rewrite an
  // http:// script to https:// and fail to load it. Saying so here beats an
  // empty dashboard and a console message nobody is looking at.
  if (parsed.protocol !== "https:" && !isLocalhostUrl(parsed)) {
    return {
      path: "UMAMI_SCRIPT_URL",
      message:
        "UMAMI_SCRIPT_URL must be HTTPS outside localhost. The page's " +
        "Content-Security-Policy upgrades insecure requests, so an http:// " +
        "script is fetched over https:// and fails if that is not served.",
    };
  }

  if (!WEBSITE_ID.test(id)) {
    return {
      path: "UMAMI_WEBSITE_ID",
      message: `UMAMI_WEBSITE_ID should be the UUID Umami shows for the website (got "${id}")`,
    };
  }

  return null;
}

/**
 * The configuration as the request path needs it, or null when analytics are
 * off — which is the default and the whole of a self-hosted install unless
 * somebody chose otherwise.
 *
 * Reads `process.env` directly rather than the parsed schema, for the same
 * reason `isSemanticCategorizationEnabled` does: `proxy.ts` needs it on every
 * request to decide one Content-Security-Policy directive, and should not
 * have to parse the whole environment to answer that.
 */
export function readUmamiConfig(
  source: NodeJS.ProcessEnv = process.env,
): UmamiConfig | null {
  const scriptUrl = (source.UMAMI_SCRIPT_URL ?? "").trim();
  const websiteId = (source.UMAMI_WEBSITE_ID ?? "").trim();

  if (scriptUrl === "" || websiteId === "") return null;
  if (umamiConfigError(scriptUrl, websiteId)) return null;

  return { scriptUrl, websiteId, origin: new URL(scriptUrl).origin };
}
