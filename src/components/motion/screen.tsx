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

/**
 * Which screen is showing, as `<Screen>` keys it: the pathname, except while a
 * layer is open over a screen, when it is the screen underneath.
 *
 * Adjusted during render rather than from an effect: an effect runs after the
 * commit, so the screen would remount for a frame before being told not to —
 * which is the remount this exists to prevent. React re-runs the component
 * immediately on a set during its own render, before anything is painted, so
 * the key is right on the first commit.
 *
 * Exported for what sits above the screen and has to agree with it about
 * where the reader is — the group header, which stays drawn under the entry
 * drawer because the screen under the drawer is still one of the group's tabs.
 */
export function useScreenPath(): string {
  const pathname = usePathname();
  const [shown, setShown] = useState(() => ({
    path: pathname,
    key: screenPath(pathname, null),
  }));
  if (shown.path !== pathname) {
    setShown({ path: pathname, key: screenPath(pathname, shown.key) });
  }
  return shown.key;
}

export function Screen({
  children,
  inset,
  sidebar,
  className,
}: {
  children: ReactNode;
  /** Clears the bottom bar, on the screens that have one. */
  inset?: boolean;
  /**
   * The screen sits beside the sidebar from `lg` up, where the bottom bar has
   * gone: the inset that cleared it goes too, the gutters open up — 24px at
   * `lg`, where the sidebar leaves 784px, and 40px from `xl` — and a screen
   * that holds a wide layout, the overview's two columns marked
   * `data-layout="wide"`, gets the room for it, up to `--app-content-max`.
   * Every other screen keeps the one readable column it has on a phone,
   * centred in the space beside the sidebar rather than stretched across it.
   *
   * Under a group's header — the tile, the name and the tabs, drawn above
   * this column on the group's four places — the column starts closer, since
   * the header has already given the screen its top margin.
   */
  sidebar?: boolean;
  /**
   * For a surface whose column is not the app's. The settings screens draw
   * their own header inside the snapshot and carry it to the top edge, so they
   * replace the padding rather than sit in it. Everything else leaves this
   * alone and gets the column every other screen has.
   */
  className?: string;
}) {
  // The screen last shown, so a path that opens over one knows which.
  const shownKey = useScreenPath();

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
        sidebar &&
          "lg:px-6 lg:pt-8 lg:pb-12 lg:peer-data-[slot=group-header]:pt-6 lg:has-data-[layout=wide]:max-w-(--app-content-max) xl:px-10",
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
      key={shownKey}
      enter={DIRECTIONS}
      exit={DIRECTIONS}
      default="none"
    >
      {screen}
    </ViewTransition>
  );
}
