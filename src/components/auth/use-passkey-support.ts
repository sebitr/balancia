"use client";

import { useSyncExternalStore } from "react";
import { supportsPasskeys } from "@/modules/auth/passkey-client";

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
