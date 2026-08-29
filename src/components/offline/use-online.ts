"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { countQueued, subscribeToOutbox } from "@/lib/offline/outbox";

/**
 * Whether the browser thinks it has a network.
 *
 * `navigator.onLine` is a weak signal and worth being honest about: it says
 * the device has an interface with a route, not that this app's server can be
 * reached. A hotel wifi that has swallowed the login page reports online.
 *
 * That is fine for what it is used for here, because nothing depends on it
 * being right. It picks the *first* thing to try — go to the server, or go
 * straight to the queue — and a wrong guess in either direction costs one
 * failed request that ends in the queue anyway. It is never the thing that
 * decides whether an entry is safe.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // The server rendered this, so there was a network. Assuming otherwise
    // would flash the offline strip onto every first paint.
    () => true,
  );
}

/**
 * How many entries are waiting to be sent.
 *
 * Read from IndexedDB on mount and re-read whenever the queue announces a
 * change, rather than held in a store beside it: the queue is also written by
 * the flush, which runs outside React, and one source of truth read twice
 * beats two that can disagree.
 */
export function useQueuedCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let live = true;
    const read = () => {
      void countQueued().then((next) => {
        if (live) setCount(next);
      });
    };
    read();
    const unsubscribe = subscribeToOutbox(read);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  return count;
}
