"use client";

import { useCallback, useEffect, useState } from "react";
import { applicationServerKey } from "@/lib/push/application-server-key";

/**
 * Subscribing this browser to push, and the several ways it can be impossible.
 *
 * The states are distinct because the fix is different for each: a blocked
 * permission needs the site settings, an iOS browser needs the app installed
 * to the home screen first, and an unconfigured instance needs the operator.
 * Collapsing them into "it didn't work" leaves people with nothing to do.
 */
export type PushStatus =
  /** Still working out what this browser can do. */
  | "checking"
  /** No Push API, or no service worker — an old browser, or a private window. */
  | "unsupported"
  /** Safari on iOS: push works, but only once added to the home screen. */
  | "installFirst"
  /** The instance has no VAPID keys. */
  | "unavailable"
  /** Supported and permitted, but this device is not subscribed. */
  | "off"
  /** Subscribed. */
  | "on"
  /** The user (or the browser) refused the permission. */
  | "blocked";

interface PushState {
  readonly status: PushStatus;
  readonly busy: boolean;
  readonly error: string | null;
}

/**
 * Whether this is an iOS browser that has not been installed yet.
 *
 * Safari exposes no Push API at all until the app is on the home screen, so
 * "unsupported" would be misleading — there is something the person can do.
 */
function needsInstallFirst(): boolean {
  if (typeof navigator === "undefined") return false;
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own, non-standard flag.
    ("standalone" in navigator && navigator.standalone === true);
  return isIos && !installed;
}

export function usePushSubscription() {
  const [state, setState] = useState<PushState>({
    status: "checking",
    busy: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState({
        status: needsInstallFirst() ? "installFirst" : "unsupported",
        busy: false,
        error: null,
      });
      return;
    }

    let publicKey: string | null = null;
    try {
      const response = await fetch("/api/push/key");
      publicKey = response.ok
        ? ((await response.json()) as { publicKey: string | null }).publicKey
        : null;
    } catch {
      publicKey = null;
    }
    if (!publicKey) {
      setState({ status: "unavailable", busy: false, error: null });
      return;
    }

    if (Notification.permission === "denied") {
      setState({ status: "blocked", busy: false, error: null });
      return;
    }

    const registration = await navigator.serviceWorker.getRegistration();
    const existing = await registration?.pushManager.getSubscription();
    setState({
      status: existing ? "on" : "off",
      busy: false,
      error: null,
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async (): Promise<boolean> => {
    setState((previous) => ({ ...previous, busy: true, error: null }));
    try {
      const keyResponse = await fetch("/api/push/key");
      const { publicKey } = (await keyResponse.json()) as {
        publicKey: string | null;
      };
      if (!publicKey) {
        setState({ status: "unavailable", busy: false, error: null });
        return false;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState({ status: "blocked", busy: false, error: null });
        return false;
      }

      // `ready` rather than `getRegistration`: the worker may still be
      // installing on a first visit, and subscribing needs it active.
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });

      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!response.ok) {
        // Do not leave the browser subscribed to something the server does
        // not know about: it would receive nothing and look enabled.
        await subscription.unsubscribe();
        const { error } = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setState({ status: "off", busy: false, error: error ?? null });
        return false;
      }

      setState({ status: "on", busy: false, error: null });
      return true;
    } catch (error) {
      setState({
        status: "off",
        busy: false,
        error: error instanceof Error ? error.message : null,
      });
      return false;
    }
  }, []);

  const disable = useCallback(async (): Promise<boolean> => {
    setState((previous) => ({ ...previous, busy: true, error: null }));
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState({ status: "off", busy: false, error: null });
      return true;
    } catch (error) {
      setState((previous) => ({
        ...previous,
        busy: false,
        error: error instanceof Error ? error.message : null,
      }));
      return false;
    }
  }, []);

  return { ...state, enable, disable, refresh };
}
