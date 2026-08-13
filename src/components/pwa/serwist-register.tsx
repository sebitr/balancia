"use client";

import { useEffect } from "react";

/**
 * Registers the Serwist service worker built by `serwist build` (see
 * serwist.config.mjs). The worker only exists in production builds, so
 * registration is skipped in development and when the browser lacks support.
 */
export function SerwistRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      typeof window === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((error) => {
        console.warn("Service worker registration failed", error);
      });
  }, []);

  return null;
}
