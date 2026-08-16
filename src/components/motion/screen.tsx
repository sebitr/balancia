"use client";

import { ViewTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { screenPath } from "./transitions";

/**
 * The screen: everything between the header and the bottom bar, and the only
 * part of the app that moves when you navigate.
 *
 * Direction belongs to the navigation, not to the destination — a group
 * arrives from the right when you tapped into it and from the left when you
 * came back to it. So the link names the motion, via `transitionTypes` and the
 * constants in `./transitions`, and this maps that name onto a CSS class that
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
}: {
  children: ReactNode;
  /** Clears the bottom bar, on the screens that have one. */
  inset?: boolean;
}) {
  const pathname = usePathname();

  // The column carries its own padding rather than inheriting it from <main>,
  // so the snapshot taken of it covers the whole screen. Padding left outside
  // would be a band the arriving screen does not paint, showing the departing
  // one through it.
  const screen = (
    <div
      data-slot="screen"
      className={cn(
        "mx-auto min-h-full w-full max-w-3xl px-4 py-6",
        inset && "pb-28",
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
      key={screenPath(pathname)}
      enter={DIRECTIONS}
      exit={DIRECTIONS}
      default="none"
    >
      {screen}
    </ViewTransition>
  );
}
