"use client";

import { useMemo, useSyncExternalStore } from "react";
import { fragmentParams } from "./drawer-fragment";

/**
 * The fragment of the URL the drawer is open at, as parameters — or null while
 * it is not yet known.
 *
 * Null on the server, and through hydration, because the fragment never
 * reaches the server and React must render the same thing on both sides until
 * the client has the page. The drawer holds its body back for that one render,
 * exactly as it does for a draft it has been asked to restore: a form that
 * appears empty and then fills itself reads as two screens. It only ever
 * happens on a cold load of the standalone route. A client-side navigation —
 * every ordinary way in — reads the fragment on the first render.
 *
 * A soft navigation fires neither `hashchange` nor `popstate` and does not
 * need to: the snapshot is read again on every render, and a navigation
 * re-renders the drawer. The listeners cover the moves the browser makes on
 * its own.
 */
export function useFragmentParams(): URLSearchParams | null {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => null,
  );
  return useMemo(() => (hash === null ? null : fragmentParams(hash)), [hash]);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}
