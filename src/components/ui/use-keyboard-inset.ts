"use client";

import { useEffect, useState } from "react";

/**
 * How much of the layout viewport the on-screen keyboard is covering.
 *
 * A phone keyboard does not shorten the page it slides over: the layout
 * viewport keeps its full height, so anything anchored to the bottom edge —
 * every sheet in this app — ends up *underneath* it, taking the search field
 * and the confirm button with it. Only the visual viewport shrinks, and what
 * sits between its bottom edge and the layout viewport's is the keyboard.
 *
 * Returns zero on desktop, and zero wherever `visualViewport` is missing, so
 * callers can add it unconditionally.
 */

/**
 * Below this, the gap is the two viewports disagreeing about collapsing
 * browser chrome rather than a keyboard — no phone keyboard is this short, and
 * shifting a sheet by a few pixels of toolbar would only look broken.
 */
const KEYBOARD_MIN = 60;

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const measure = () => {
      // `offsetTop` is how far the visual viewport has itself been pushed down
      // inside the layout one; that part is not keyboard, so it comes off too.
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(covered > KEYBOARD_MIN ? Math.round(covered) : 0);
    };

    measure();
    // Height changes as the keyboard opens; `scroll` fires while iOS moves the
    // visual viewport around to keep the focused field in sight.
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, []);

  return inset;
}
