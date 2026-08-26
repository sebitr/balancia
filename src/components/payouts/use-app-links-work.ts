"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a custom URL scheme could plausibly reach an app.
 *
 * `upi://pay?…` is the one link here that is not an https address, and a scheme
 * with no app behind it does not fail loudly: the browser simply does nothing,
 * which is the dead button this whole feature was written to avoid. https links
 * need none of this — they land on the provider's own page when the app is
 * absent — so this is only ever consulted for the scheme kind.
 *
 * A phone is the proxy, because the apps in question ship on phones and nowhere
 * else. Coarse pointer *and* a touch point, rather than a user-agent string:
 * touch alone would take in a touchscreen laptop, and sniffing the agent is a
 * table that goes stale in a way a capability does not.
 *
 * `useSyncExternalStore` rather than an effect, as `usePasskeySupport` does for
 * the same kind of question: this is a fact about the environment, not state to
 * synchronize. The server snapshot is `false` so the markup rendered on the
 * server matches the first client render — a button that appears a frame late
 * was never wrong, where one rendered present and then removed is a flash, a
 * layout shift, and on a slow phone a tap that lands on whatever slid into its
 * place.
 */

const QUERY = "(pointer: coarse)";

// The pointer can change under a page — an iPad gains a trackpad — so this
// subscribes properly rather than no-op'ing, and the button follows.
function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getClientSnapshot(): boolean {
  return window.matchMedia(QUERY).matches && navigator.maxTouchPoints > 0;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useAppLinksWork(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
