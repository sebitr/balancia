import { describe, expect, it } from "vitest";
import {
  OFFLINE_URL,
  precacheManifestTransform,
  toServedUrl,
} from "./precache-urls.mjs";

/**
 * A precache entry pointing at a URL the app does not serve is not a slow
 * cache — it is a service worker that never installs, and therefore never
 * activates. Everything that waits on `navigator.serviceWorker.ready` then
 * waits forever, which is how enabling push notifications came to hang with
 * the button stuck disabled and nothing in any log to say why.
 *
 * The manifest is built by globbing `.next`, so these are the shapes that
 * arrive: paths relative to the build directory, not URLs.
 */
describe("precache URLs", () => {
  it("serves build assets from the /_next prefix", () => {
    expect(toServedUrl("static/chunks/turbopack-2x6wo2vvhvyfn.js")).toBe(
      "/_next/static/chunks/turbopack-2x6wo2vvhvyfn.js",
    );
    expect(toServedUrl("static/media/GeistMono_Variable.p.woff2")).toBe(
      "/_next/static/media/GeistMono_Variable.p.woff2",
    );
  });

  it("maps the prerendered offline page onto its route", () => {
    expect(toServedUrl("server/app/offline.html")).toBe(OFFLINE_URL);
    // The extension is sometimes stripped before a transform sees the entry.
    expect(toServedUrl("server/app/offline")).toBe(OFFLINE_URL);
    expect(toServedUrl("/server/app/offline")).toBe(OFFLINE_URL);
  });

  it("leaves an unrecognised path alone rather than guessing", () => {
    // A new glob pattern should surface as a visible 404 to be mapped on
    // purpose, not be quietly rewritten into a plausible-looking URL.
    expect(toServedUrl("server/app/some-new-thing.html")).toBe(
      "server/app/some-new-thing.html",
    );
  });

  it("rewrites a whole manifest and keeps every revision", () => {
    const { manifest } = precacheManifestTransform([
      { url: "static/chunks/a.js", revision: "rev-a" },
      { url: "server/app/offline.html", revision: "rev-offline" },
    ]);

    expect(manifest).toEqual([
      { url: "/_next/static/chunks/a.js", revision: "rev-a" },
      { url: OFFLINE_URL, revision: "rev-offline" },
    ]);
  });

  it("produces only URLs the app answers on", () => {
    // The invariant the service worker's install step depends on: every
    // precache URL is absolute and rooted at something Next.js serves.
    const { manifest } = precacheManifestTransform([
      { url: "static/media/font.woff2", revision: "1" },
      { url: "static/chunks/page.css", revision: "2" },
      { url: "server/app/offline.html", revision: "3" },
    ]);

    for (const entry of manifest) {
      expect(
        entry.url.startsWith("/_next/static/") || entry.url === OFFLINE_URL,
        `${entry.url} is not a URL this app serves`,
      ).toBe(true);
    }
  });
});
