"use client";

import { useSyncExternalStore } from "react";
import {
  countryForTimezone,
  type SupportedCountry,
} from "@/modules/settlements/payment-methods";

/**
 * Which country the reader is in, as far as anything on the page can tell.
 *
 * The phone's own timezone, which is the best signal there is before anybody
 * has been asked anything — better than the currency, which says nothing (EUR
 * spans twenty countries), and better than one more question on a settings
 * screen. It is only ever used to choose an example, so being wrong costs a
 * greyed-out number that is written the way somebody else's country writes it,
 * which is what this whole file exists to reduce rather than guarantee.
 *
 * `useSyncExternalStore` with a null server snapshot, as `useAppLinksWork`
 * does for the same kind of question: the server's timezone is the machine's
 * and has nothing to do with the reader's, so the markup it renders must not
 * pretend to know. The country arrives with hydration instead, and the only
 * thing that changes is an example in an empty field.
 */

/** A phone's timezone does not change under a page, so there is nothing to
 * listen to — and `useSyncExternalStore` still wants a subscription. */
function subscribe(): () => void {
  return () => {
    // Nothing to unsubscribe from.
  };
}

function getClientSnapshot(): SupportedCountry | null {
  return countryForTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function getServerSnapshot(): SupportedCountry | null {
  return null;
}

export function useViewerCountry(): SupportedCountry | null {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
