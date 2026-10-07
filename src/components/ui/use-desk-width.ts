"use client";

import { useSyncExternalStore } from "react";

/*
 * Whether the window is a desk's: `lg`, 64rem, and up.
 *
 * For the few places where a desk is not the phone's layout restyled but a
 * different arrangement of the same parts — the transactions table instead of
 * the list, the entry dialog's split laid out in place instead of behind a
 * row. CSS alone cannot move a control to a different place in the reading
 * order, and drawing it twice with one copy hidden would hand every test and
 * every screen reader two of it.
 *
 * Unknown on the server and through hydration, since the server cannot know
 * the width and hydration has to match what it sent: a caller draws the
 * phone's arrangement, or both with CSS showing one, until the first client
 * render says which.
 */
export const DESK_QUERY = "(min-width: 64rem)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DESK_QUERY);
  media.addEventListener?.("change", onChange);
  return () => media.removeEventListener?.("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(DESK_QUERY).matches;
}

/** Unknown on the server, which is what renders both. */
function getServerSnapshot(): null {
  return null;
}

/** True from `lg` up, false below it, null until the width is known. */
export function useDeskWidth(): boolean | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
