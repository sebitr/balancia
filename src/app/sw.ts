/// <reference lib="webworker" />
import { Serwist, NetworkFirst, NetworkOnly, CacheFirst } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { applicationServerKey } from "@/lib/push/application-server-key";

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
      // Manifest icons, plus the app icons Next.js links into <head>. Those
      // carry a cache-busting query, so match on the path alone.
      matcher: ({ url }) =>
        url.pathname.startsWith("/icons/") ||
        url.pathname === "/icon.svg" ||
        url.pathname === "/apple-icon.png" ||
        url.pathname === "/favicon.ico" ||
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

/**
 * Push notifications.
 *
 * The payload arrives encrypted end to end (RFC 8291) and is decrypted by the
 * browser before this handler sees it, so the push service in the middle
 * relayed ciphertext it could not read. What lands here is the JSON the server
 * rendered in the recipient's language.
 */

interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly tag: string;
  readonly notificationId: string;
}

/** Everything Balancia sends is a real event; nothing here is promotional. */
const FALLBACK_TITLE = "Balancia";

function parsePayload(event: PushEvent): PushPayload | null {
  if (!event.data) return null;
  try {
    const parsed: unknown = event.data.json();
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as PushPayload).title !== "string" ||
      typeof (parsed as PushPayload).body !== "string"
    ) {
      return null;
    }
    return parsed as PushPayload;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePayload(event);

  // Chrome revokes the push permission from an origin that receives a message
  // and shows nothing, so there is always a notification — even for a payload
  // that failed to parse.
  const title = payload?.title ?? FALLBACK_TITLE;
  const options: NotificationOptions = {
    body: payload?.body ?? "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    // Collapses repeated news about one expense into a single card.
    tag: payload?.tag ?? "balancia",
    data: { url: payload?.url ?? "/notifications" },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);

      // Tell any open tab to re-read its unread count. Without this the lock
      // screen updates and the header does not, until the next navigation.
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        client.postMessage({ type: "balancia:notification" });
      }
    })(),
  );
});

/**
 * Opening a notification.
 *
 * Focuses a tab that already has Balancia open rather than piling up windows;
 * only when there is none does it open one.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data as { url?: string } | undefined;
  const target = new URL(data?.url ?? "/notifications", self.location.origin);
  // Never navigate somewhere else because a payload said so.
  const path =
    target.origin === self.location.origin
      ? `${target.pathname}${target.search}`
      : "/notifications";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(path);
        }
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});

/**
 * Endpoint rotation.
 *
 * A push service may retire a subscription and hand the browser a new one. The
 * server has to be told, or this device silently stops being notified — the
 * failure mode nobody reports because nothing visibly breaks.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const change = event as PushSubscriptionChangeEvent;
  event.waitUntil(
    (async () => {
      try {
        const response = await fetch("/api/push/key");
        if (!response.ok) return;
        const { publicKey } = (await response.json()) as {
          publicKey: string | null;
        };
        if (!publicKey) return;

        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        });

        await fetch("/api/push/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscription,
            // Lets the server drop the row this one replaces.
            previousEndpoint: change.oldSubscription?.endpoint ?? null,
          }),
        });
      } catch {
        // Nothing useful to do here: the settings page re-subscribes on its
        // next visit, and the server drops the endpoint when it 404s.
      }
    })(),
  );
});
