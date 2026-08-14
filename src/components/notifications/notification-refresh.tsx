"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the unread badge honest while a tab is open.
 *
 * Without this, a push that arrives on a device already showing Balancia
 * updates the lock screen but not the header, and the count only catches up on
 * the next navigation. The service worker posts a message on every push; this
 * turns that into a re-render of the server components that read the count.
 */
export function NotificationRefresh() {
  const router = useRouter();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | undefined;
      if (data?.type === "balancia:notification") {
        router.refresh();
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [router]);

  return null;
}
