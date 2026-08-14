"use client";

import { useEffect, type RefObject } from "react";
import { useKeyboardInset } from "./use-keyboard-inset";

/** Breathing room between the sticky header and the field pulled under it. */
const GAP = 8;

/**
 * Lift a field that lives in the page — not in a sheet — clear of the
 * on-screen keyboard.
 *
 * `useKeyboardInset` on its own is enough for a sheet, which is anchored to
 * the bottom edge and can simply sit on top of the keyboard. A field in the
 * scrolling page cannot move like that; the page has to scroll to it, and the
 * browser already does that badly on purpose — it scrolls the *minimum*
 * distance, so the field lands just above the keyboard and the list it filters
 * stays underneath it. A search whose results you cannot see is the whole
 * complaint.
 *
 * So the field goes to the top instead, under the header, which spends what
 * the keyboard left on the results rather than on the page above them.
 *
 * That needs somewhere to scroll to. A field near the end of the page has
 * nothing below it to pull up, and the keyboard does not shorten the layout
 * viewport, so the page is exactly as scrollable as it was — which is why the
 * browser gave up where it did. The returned padding is the room the caller
 * has to render below the field for any of this to be able to move.
 *
 * Returns zero on desktop, where nothing is covered.
 */
export function useKeyboardReveal(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): number {
  const keyboard = useKeyboardInset();
  const room = active ? keyboard : 0;

  useEffect(() => {
    const element = ref.current;
    if (!element || room === 0) return;

    // The padding this scroll spends is rendered from the same value in the
    // same commit, so it is already in the document by the time we get here.
    const header = document.querySelector('[data-slot="app-header"]');
    const headroom = (header?.getBoundingClientRect().height ?? 0) + GAP;

    // Measured against the layout viewport, which is the one `scrollTo` moves.
    // iOS may briefly have scrolled the visual viewport inside it as well; it
    // puts that back, and aiming off it would fight what it is doing.
    const top = element.getBoundingClientRect().top + window.scrollY - headroom;

    // Instant, and not only out of deference to reduced motion. The keyboard
    // is sliding up over this, and the browser is running its own scroll
    // underneath — a third animation racing those two arrives late and looks
    // like a stutter. Landing behind the keyboard is the whole point.
    window.scrollTo({ top, behavior: "auto" });
  }, [ref, room]);

  return room;
}
