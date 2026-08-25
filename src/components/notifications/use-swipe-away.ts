"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Push a row off to the left to be rid of it.
 *
 * Modelled on the sheet's drag-to-dismiss, and for the same reasons: the node
 * arrives in state rather than in a ref so the effect can wait for it, and the
 * row is moved by writing `transform` directly rather than by holding the
 * offset in React state — a list of sixteen rows re-rendering on every
 * pointermove is a list that stutters on the phone it was designed for.
 *
 * Only touch. A mouse has no swipe idiom on a list like this, and binding one
 * would turn every text selection near a row into a dismissal.
 */

/** Movement before a touch is a drag rather than a tap, in pixels. */
const SLOP = 6;
/** Let go past this far to the left and the row goes. */
const THRESHOLD = 104;
/** How a row that fell short returns to where it was. */
const SPRING = "transform 200ms cubic-bezier(0.2,0,0,1)";

export function useSwipeAway(onDismiss: () => void) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const dismiss = useRef(onDismiss);

  // Kept fresh so the listeners below, bound once, always call the current
  // handler rather than the one that existed when the row first mounted.
  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!element) return;

    const gentle = window.matchMedia("(prefers-reduced-motion: reduce)");

    let tracking = false;
    let dragging = false;
    let pointer = -1;
    let startX = 0;
    let startY = 0;

    const offset = (value: number) => {
      element.style.transform = `translate3d(${value}px, 0, 0)`;
    };

    const release = () => {
      tracking = false;
      dragging = false;
      pointer = -1;
      element.removeAttribute("data-swiping");
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      tracking = true;
      pointer = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointer || (!tracking && !dragging)) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (tracking) {
        // A gesture that set off downwards is the page scrolling, and the row
        // must let go of it rather than compete for the same finger.
        if (Math.abs(dy) > Math.abs(dx)) {
          release();
          return;
        }
        if (dx > -SLOP) return;
        tracking = false;
        dragging = true;
        element.style.transition = "none";
        element.setAttribute("data-swiping", "");
      }

      // Rightwards is nothing: there is no action on that side to reveal.
      offset(Math.min(0, dx));
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      const travelled = event.clientX - startX;
      const wasDragging = dragging;
      release();
      if (!wasDragging) return;

      if (travelled <= -THRESHOLD) {
        if (gentle.matches) {
          dismiss.current();
          return;
        }
        element.style.transition = SPRING;
        offset(-element.getBoundingClientRect().width);
        element.addEventListener("transitionend", () => dismiss.current(), {
          once: true,
        });
        return;
      }

      element.style.transition = gentle.matches ? "none" : SPRING;
      offset(0);
    };

    // The list must not scroll under a gesture that has become a drag.
    const onTouchMove = (event: TouchEvent) => {
      if (dragging && event.cancelable) event.preventDefault();
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("touchmove", onTouchMove);
    };
  }, [element]);

  return setElement;
}
