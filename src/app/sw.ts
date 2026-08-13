/// <reference lib="webworker" />
import { Serwist, NetworkFirst, NetworkOnly, CacheFirst } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

/**
 * Balancia service worker.
 *
 * Caching rules, and why each one is what it is:
 *
 *  - Versioned build assets (/_next/static/**) are immutable, so CacheFirst.
 *  - Icons and the manifest are safe to cache and rarely change.
 *  - Authenticated financial views are NetworkFirst: always try the server, so
 *    a balance is never shown from a stale cache when the network is up. The
 *    cached copy exists only so a brief drop-out does not blank the screen.
 *  - Authentication endpoints (/api/auth/**) are NEVER cached. A cached session
 *    response is a security problem, not a performance win.
 *  - Mutations (anything not GET) are never cached, and there is no background
 *    sync: this version does not support offline data entry, deliberately —
 *    queueing financial writes would require conflict resolution the product
 *    was not asked for.
 *  - Anything not matched falls through to the network, with an offline shell
 *    for navigations.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const OFFLINE_URL = "/offline";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // Authentication: never cached, never served from a cache.
      matcher: ({ url }) => url.pathname.startsWith("/api/auth"),
      handler: new NetworkOnly(),
    },
    {
      // Receipt downloads carry private content; keep them off disk.
      matcher: ({ url }) => url.pathname.includes("/attachments/"),
      handler: new NetworkOnly(),
    },
    {
      // Every other API call, and all mutations, go straight to the network.
      matcher: ({ url, request }) =>
        url.pathname.startsWith("/api/") || request.method !== "GET",
      handler: new NetworkOnly(),
    },
    {
      // Immutable, content-hashed build output.
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "balancia-static",
      }),
    },
    {
      matcher: ({ url }) =>
        url.pathname.startsWith("/icons/") ||
        url.pathname === "/icon.svg" ||
        url.pathname === "/manifest.webmanifest",
      handler: new CacheFirst({ cacheName: "balancia-assets" }),
    },
    {
      // Financial views: network first, cache only as a stop-gap.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "balancia-pages",
        networkTimeoutSeconds: 5,
      }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: OFFLINE_URL,
        matcher: ({ request }) => request.mode === "navigate",
      },
    ],
  },
});

serwist.addEventListeners();
