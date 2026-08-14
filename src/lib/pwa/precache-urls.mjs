/**
 * Turning build-output paths into the URLs the app actually serves.
 *
 * Serwist builds its precache manifest by globbing a directory, so every entry
 * arrives as a path relative to `globDirectory` — `.next` here. That gives
 * `static/chunks/abc.js` and `server/app/offline.html`, and neither is a URL
 * this app answers on: the browser fetches build assets from `/_next/static/…`,
 * and the offline shell from the `/offline` route.
 *
 * Left alone, every entry in the manifest is a 404. That is not a caching
 * inefficiency — it fails the service worker's install step, so the worker
 * never activates, `navigator.serviceWorker.ready` never resolves, and
 * everything waiting on it waits forever. Enabling push notifications is the
 * one that shows: the button disables itself and never comes back.
 *
 * Plain `.mjs` rather than TypeScript because `serwist.config.mjs` is loaded by
 * the Serwist CLI as ordinary ESM, with no TypeScript loader in front of it.
 */

/** The route that renders the offline shell. */
export const OFFLINE_URL = "/offline";

/** Where Next.js serves the contents of `.next/static`. */
const STATIC_PREFIX = "/_next/static/";

/**
 * The prerendered offline page, as Serwist reports it. The extension is
 * sometimes already stripped by the time a transform sees the entry, so both
 * spellings are accepted rather than depending on which.
 */
const OFFLINE_BUILD_PATHS = new Set([
  "server/app/offline.html",
  "server/app/offline",
]);

/**
 * Maps one manifest path onto the URL it is served from.
 *
 * Anything unrecognised is returned unchanged: a new glob pattern should show
 * up as a visible 404 to be mapped deliberately, not be silently rewritten
 * into some plausible-looking URL.
 */
export function toServedUrl(url) {
  const path = url.replace(/^\/+/, "");

  if (OFFLINE_BUILD_PATHS.has(path)) return OFFLINE_URL;
  if (path.startsWith("static/")) {
    return `${STATIC_PREFIX}${path.slice("static/".length)}`;
  }

  return url;
}

/**
 * A Serwist `manifestTransforms` entry applying {@link toServedUrl} to every
 * precache URL, leaving each revision untouched.
 */
export function precacheManifestTransform(entries) {
  return {
    manifest: entries.map((entry) => ({
      ...entry,
      url: toServedUrl(entry.url),
    })),
    warnings: [],
  };
}
