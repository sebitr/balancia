"use client";

import { useState, ViewTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { screenPath } from "./transitions";

/**
 * The screen: everything between the header and the bottom bar, and the only
 * part of the app that moves when you navigate.
 *
 * What moves belongs to the navigation, not to the destination — a group
 * arrives from the right when you tapped into it and from the left when you
 * came back to it, and a peer on the tab bar does not arrive from anywhere at
 * all. So the link names the motion, via `transitionTypes` and the constants
 * in `./transitions`, and this maps that name onto a CSS class that
 * `globals.css` animates.
 *
 * Keyed by pathname. A `<ViewTransition>` in a layout normally never animates,
 * because layouts survive navigation and so never enter or exit; changing the
 * key makes React tear the old screen down and raise the new one, which is the
 * pair the enter and exit animations need. Doing it here rather than in every
 * page also means a page added later is carried along without being asked to
 * remember anything.
 *
 * Three things deliberately do not move it. A change of search params keeps
 * the pathname, so filtering a list does not re-enter the screen. A navigation
 * carrying no direction animates nothing at all: `router.refresh()` runs here
 * whenever a push notification lands on an open tab, and a screen that slid
 * sideways every time somebody else recorded an expense would be claiming a
 * navigation that never happened. And a path that opens *over* the screen
 * rather than replacing it keys to the screen underneath — see `screenPath`.
 */
const DIRECTIONS = {
  push: "push",
  pop: "pop",
  "switch-forward": "switch-forward",
  "switch-back": "switch-back",
  default: "none",
};

export function Screen({
  children,
  inset,
  className,
}: {
  children: ReactNode;
  /** Clears the bottom bar, on the screens that have one. */
  inset?: boolean;
  /**
   * For a surface whose column is not the app's. The settings screens draw
   * their own header inside the snapshot and carry it to the top edge, so they
   * replace the padding rather than sit in it. Everything else leaves this
   * alone and gets the column every other screen has.
   */
  className?: string;
}) {
  const pathname = usePathname();

  // The screen last shown, so a path that opens over one knows which.
  //
  // Adjusted during render rather than from an effect: an effect runs after
  // the commit, so the screen would remount for a frame before being told not
  // to — which is the remount this exists to prevent. React re-runs the
  // component immediately on a set during its own render, before anything is
  // painted, so the key is right on the first commit.
  const [shown, setShown] = useState(() => ({
    path: pathname,
    key: screenPath(pathname, null),
  }));
  if (shown.path !== pathname) {
    setShown({ path: pathname, key: screenPath(pathname, shown.key) });
  }

  // The column carries its own padding rather than inheriting it from <main>,
  // so the snapshot taken of it covers the whole screen. Padding left outside
  // would be a band the arriving screen does not paint, showing the departing
  // one through it.
  const screen = (
    <div
      data-slot="screen"
      className={cn(
        "mx-auto min-h-full w-full max-w-3xl px-4 py-6",
        // Clears the fixed group navigation, its raised Add button, and the
        // iOS PWA home-indicator area. Pages without a bottom bar keep the
        // regular `py-6` inset above.
        inset && "pb-[calc(8rem+env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {children}
    </div>
  );

  // Only the canary React the App Router bundles has `ViewTransition`; under
  // the plain React 19 the component tests run on, a screen is just a screen.
  if (!ViewTransition) return screen;

  return (
    <ViewTransition
      key={shown.key}
      enter={DIRECTIONS}
      exit={DIRECTIONS}
      default="none"
    >
      {screen}
    </ViewTransition>
  );
}
