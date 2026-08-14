"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Drag the left edge to go back.
 *
 * Installed, Balancia has no browser chrome and no back button — on a phone
 * the only way out of a screen is the edge, and a home-screen app that ignores
 * it is a web page wearing an icon. So the gesture is rebuilt here: a drag
 * that starts at the edge takes the screen with it, and letting go either
 * finishes the movement or returns it.
 *
 * The whole animation is one number, `--swipe-progress` on the document, from
 * 0 at rest to 1 fully off. `globals.css` derives the screen's position, the
 * ground behind it and the scrim over that ground from it.
 *
 * Navigation happens only once the screen is off, never during: the previous
 * page renders into the same element, so swapping it mid-flight would show the
 * page being travelled *to* sliding away instead.
 *
 * Listening on the document rather than on a strip along the edge is
 * deliberate. A strip would have to sit above the page to receive the touch,
 * and would then swallow every tap that landed within it — including the first
 * tab of the bottom bar, which reaches almost to the edge.
 */

/** How far in from the edge a touch may land and still be a back gesture. */
const EDGE = 24;
/** Movement before the gesture commits to being horizontal, in pixels. */
const SLOP = 8;
/** Past this share of the viewport, letting go finishes the movement. */
const DISTANCE_THRESHOLD = 0.36;
/** A flick this fast finishes it however far it got, in pixels per ms. */
const VELOCITY_THRESHOLD = 0.45;
/** Bounds on how long the screen takes to settle once released, in ms. */
const SETTLE_MIN = 170;
const SETTLE_MAX = 380;
/** Longest the screen may stay mid-gesture before it is put back. */
const RECOVERY = 700;

export function SwipeBack() {
  const router = useRouter();
  const pathname = usePathname();

  // How many of our own screens are behind this one. At zero there is nothing
  // to go back to and the edge is not a control.
  const depth = useRef(0);
  const popped = useRef(false);
  const first = useRef(true);
  // Set by a committed gesture, waiting on the destination to render.
  const arriving = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onPopState = () => {
      popped.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (popped.current) {
      popped.current = false;
      depth.current = Math.max(0, depth.current - 1);
    } else {
      depth.current += 1;
    }
    // The destination is on screen; let the gesture finish its arrival.
    const arrive = arriving.current;
    arriving.current = null;
    arrive?.();
  }, [pathname]);

  useEffect(() => {
    // A screen crossing the viewport is the motion most likely to make someone
    // unwell. Where that is unwelcome, the edge is simply not a control.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // A mouse has a back button and a keyboard has its own shortcut; this is
    // for the hand holding the phone.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const root = document.documentElement;
    let dragging = false;
    let tracking = false;
    let pointer = -1;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastAt = 0;
    let velocity = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const setProgress = (value: number) => {
      root.style.setProperty("--swipe-progress", value.toFixed(4));
    };

    const release = () => {
      root.removeAttribute("data-swipe");
      root.style.removeProperty("--swipe-progress");
      root.style.removeProperty("--swipe-settle");
      arriving.current = null;
      clearTimeout(timer);
    };

    const stop = () => {
      dragging = false;
      tracking = false;
      pointer = -1;
      velocity = 0;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (
        tracking ||
        dragging ||
        event.pointerType !== "touch" ||
        !event.isPrimary ||
        event.clientX > EDGE ||
        depth.current === 0 ||
        // Sign-in and the marketing page have no screen to move. Navigating
        // away from under the reader without moving anything would be worse
        // than not answering the gesture at all.
        !document.querySelector('[data-slot="app-screen"]') ||
        // Radix seals the page behind an open dialog; the edge is part of the
        // page, so it stays sealed too.
        document.body.style.pointerEvents === "none"
      ) {
        return;
      }
      tracking = true;
      pointer = event.pointerId;
      startX = lastX = event.clientX;
      startY = event.clientY;
      lastAt = event.timeStamp;
      velocity = 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;

      const dx = event.clientX - startX;

      if (tracking) {
        const dy = Math.abs(event.clientY - startY);
        // Backwards, or more down the page than across it: this is a scroll,
        // and the gesture was never ours.
        if (dx < -SLOP || (dy > SLOP && dy > Math.abs(dx))) return stop();
        if (dx < SLOP) return;

        tracking = false;
        dragging = true;
        root.setAttribute("data-swipe", "drag");
      }

      const elapsed = event.timeStamp - lastAt;
      if (elapsed > 0) {
        velocity = (event.clientX - lastX) / elapsed;
        lastX = event.clientX;
        lastAt = event.timeStamp;
      }

      // Dragging back past the start rubber-bands rather than tearing the
      // screen off its own left edge.
      const travel = dx < 0 ? dx / 4 : dx;
      setProgress(Math.max(0, travel / window.innerWidth));
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      if (!dragging) return stop();
      stop();

      const travelled = Math.max(
        0,
        (event.clientX - startX) / window.innerWidth,
      );
      const commit =
        travelled > DISTANCE_THRESHOLD || velocity > VELOCITY_THRESHOLD;

      // What is left of the journey decides how long it takes, so a screen
      // nearly off does not linger and one barely moved does not snap.
      const remaining = commit ? 1 - travelled : travelled;
      const settle = Math.round(
        Math.min(SETTLE_MAX, Math.max(SETTLE_MIN, remaining * 460)),
      );
      root.style.setProperty("--swipe-settle", `${settle}ms`);
      root.setAttribute("data-swipe", "settle");
      // A frame between the attribute and the value, so the transition the
      // attribute switches on has somewhere to start from.
      requestAnimationFrame(() => setProgress(commit ? 1 : 0));

      if (!commit) {
        timer = setTimeout(release, settle + 60);
        return;
      }

      timer = setTimeout(() => {
        arriving.current = () => {
          clearTimeout(timer);
          // Off screen and out of the way: the destination renders into it
          // unseen, then eases in from under the parallax.
          root.setAttribute("data-swipe", "arrive");
          setProgress(0);
          timer = setTimeout(release, RECOVERY);
        };
        router.back();
        // Nothing behind us after all, or a destination that never renders:
        // put the screen back rather than leave a blank one.
        timer = setTimeout(release, RECOVERY);
      }, settle);
    };

    // The page must not scroll under a gesture that has become ours.
    const onTouchMove = (event: TouchEvent) => {
      if (dragging && event.cancelable) event.preventDefault();
    };

    // A drag that ends over a link is not a tap on it.
    const onClick = (event: MouseEvent) => {
      if (!root.hasAttribute("data-swipe")) return;
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("click", onClick, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("click", onClick, true);
      release();
    };
  }, [router]);

  return <div data-slot="swipe-ground" aria-hidden="true" />;
}
