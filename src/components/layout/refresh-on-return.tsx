"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Brings the screen up to date when the reader comes back to it.
 *
 * An installed app has no reload button and no pull-to-refresh — the browser
 * chrome that carries both is exactly what `display: standalone` takes away.
 * So a group left open on Friday and reopened on Monday used to show Friday's
 * balances, with nothing on the screen admitting it, until something was
 * tapped that happened to navigate.
 *
 * `visibilitychange` is the signal, not `focus`: focus fires when a sheet
 * closes or the address bar is dismissed, several times a minute, none of
 * which means the reader has been away.
 *
 * ## Why it is not every return
 *
 * Switching out to copy an IBAN and straight back is the common case, and
 * re-rendering the whole tree for it would spend a request to redraw the same
 * pixels. So a return only counts once the screen has been out of sight long
 * enough for the group to plausibly have moved on — see `STALE_AFTER`.
 *
 * The clock is reset by the refresh itself as well as by leaving, so a reader
 * flicking between apps repeatedly gets one refresh, not one per flick.
 *
 * ## Why it checks the network first
 *
 * Offline, `router.refresh()` reaches the service worker, which has nothing
 * fresher than what is already rendered — so the cost is a failed request and
 * the reward is nothing. The queue has its own trigger for coming back online
 * (`OutboxFlusher`), and that one already refreshes when it drains.
 */

/** How long away makes a screen worth re-reading, in milliseconds. */
const STALE_AFTER = 60_000;

export function RefreshOnReturn() {
  const router = useRouter();
  // Seeded in the effect, not here: reading the clock during render is a
  // result that changes every time React happens to re-run the component.
  const freshAt = useRef(0);

  useEffect(() => {
    freshAt.current = Date.now();

    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        /*
         * Noted on the way out rather than measured on the way in. A tab that
         * was hidden by the phone locking and a tab that was hidden an hour
         * ago look identical on return; only the moment it went dark tells
         * them apart.
         */
        freshAt.current = Date.now();
        return;
      }

      if (Date.now() - freshAt.current < STALE_AFTER) return;
      if (!navigator.onLine) return;

      freshAt.current = Date.now();
      router.refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return null;
}
