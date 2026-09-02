"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  supportsPasskeys,
  supportsPlatformPasskeys,
} from "@/modules/auth/passkey-client";

/**
 * Whether this browser can do WebAuthn.
 *
 * `useSyncExternalStore` rather than an effect: the answer is a fact about the
 * environment, not state to synchronize. The server snapshot is `false` so the
 * markup rendered on the server matches the first client render, and the real
 * answer arrives without a second render pass storing it into state.
 */

// The capability never changes for the life of the page, so the subscription
// is a no-op — there is nothing to be notified about.
const subscribe = (): (() => void) => () => {};

const getClientSnapshot = (): boolean => supportsPasskeys();

const getServerSnapshot = (): boolean => false;

export function usePasskeySupport(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

/**
 * Whether this device can hold a passkey of its own: true, false, or null
 * while the browser is still answering.
 *
 * Asked once per mount rather than read, because the answer is a promise —
 * the browser resolves it against the platform authenticator, not a table.
 * The null is deliberate: a screen that has to lay out its buttons before the
 * answer arrives keeps the passkey first until told otherwise, so a phone
 * never sees the order flip.
 */
export function usePlatformAuthenticator(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supportsPlatformPasskeys().then((answer) => {
      if (!cancelled) setAvailable(answer);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}
