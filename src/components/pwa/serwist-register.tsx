"use client";

import { useEffect } from "react";

/**
 * Registers the Serwist service worker built by `serwist build` (see
 * serwist.config.mjs). The worker only exists in production builds, so
 * registration is skipped in development and when the browser lacks support.
 *
 * Safe to call again: registering the script that is already registered
 * hands back the existing registration and does nothing else.
 */
export function registerServiceWorker(): Promise<void> {
  if (
    process.env.NODE_ENV !== "production" ||
    typeof window === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return Promise.resolve();
  }
  return navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(() => undefined)
    .catch((error: unknown) => {
      console.warn("Service worker registration failed", error);
    });
}

/**
 * Mounted by the shells that are the app — `AppShell`, which the signed-in
 * screens and every group screen (guests' included) render in, and the
 * settings layout — and deliberately not by the root layout.
 *
 * Installing the worker precaches every build chunk under the size line in
 * `serwist.config.mjs`, a few megabytes fetched in the background. That is
 * the point for somebody using the app, whose next cold start may have no
 * signal; it is a strange thing to do to a visitor reading the homepage, or
 * to somebody who opened a join link and has not said yes yet. The first
 * screen of the app they reach registers it, and from then on the worker
 * serves every page at this origin, the homepage included.
 *
 * Turning push on from the onboarding checklist, before any of those shells,
 * registers it too: see `usePushSubscription`.
 */
export function SerwistRegister() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return null;
}
