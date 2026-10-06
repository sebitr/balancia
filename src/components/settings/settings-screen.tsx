import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { SettingsClose } from "./settings-close";

/**
 * The chrome every settings screen shares.
 *
 * One surface with two headers, both of them `<PageHeader>`. The hub names
 * itself and offers the way out of settings altogether; a detail screen names
 * itself and offers the way back to the hub. Both sit at the top edge and stay
 * there while the column under them scrolls — `sticky` against the page's own
 * scroll rather than a nested scroller, because a scroll container inside the
 * document is what breaks momentum scrolling and the address-bar collapse on
 * iOS.
 *
 * The header is inside the transitioning column on purpose: pushing from the
 * hub to a screen should carry the title with it, the way a native stack does.
 * A header hoisted into the layout would sit still while its own screen slid
 * out from under it.
 *
 * Settings is a surface of its own, with no app header above it, so the
 * padding here is the surface's rather than `<Screen>`'s: its own gutter, and
 * the top safe area on the one screen that draws to the top edge.
 *
 * ## From `lg` up, a pane
 *
 * There the surface draws the hub to the left of every screen and holds the ✕
 * itself, along the top of both (`src/app/settings/layout.tsx`), so a screen
 * stops being a page of its own and becomes the right-hand pane. What it gives
 * up is exactly what the surface took over: the arrow back to a hub that is
 * now beside it, the ✕ the surface draws once, the gutter the pane's column
 * already has, the full height of a window it now shares with a header, and
 * the sticky header — at that width nothing sticks to the top, the ✕ included,
 * because a desk scrolls a page rather than a stack. The title stays, and
 * leads at the size the hub's own name has on a phone.
 */
export function SettingsScreen({
  title,
  back,
  close,
  children,
}: {
  title: string;
  /** The way back to the hub. Absent on the hub itself, which closes instead. */
  back?: { href: string; label: string };
  /**
   * The way out of settings. The hub's ✕, and only the hub's. It names no
   * destination: it goes back to wherever settings was opened from, which
   * only the browser knows — see `SettingsClose`.
   */
  close?: { label: string };
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <PageHeader
        title={title}
        back={back && { ...back, until: "lg" }}
        trailing={
          close && (
            <span className="contents lg:hidden">
              <SettingsClose label={close.label} />
            </span>
          )
        }
        className={cn(
          "sticky top-0 z-10 px-3.5",
          "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
          // A detail title is a row label beside its arrow; the hub's is the
          // page's own name and gets the room to say so.
          back ? "py-2.5" : "pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3",
          "lg:static lg:px-0 lg:pt-0 lg:pb-4",
        )}
      />

      {/* The pixel at the top is the first card's own outline. Every card here
          is drawn with `ring-1`, and a ring is painted *outside* the border
          box — so a column starting flush against the header puts that line
          under a sticky, near-opaque, blurred bar, and the top card arrives
          with three sides. The rest of the column never notices, because a
          gap already stands between one card and the next.

          The bottom inset clears the iOS home indicator. The hub spaces its
          labelled groups further apart than a detail screen spaces its cards. */}
      <div
        className={cn(
          "flex flex-1 flex-col px-3.5 pt-px pb-[calc(1.625rem+env(safe-area-inset-bottom))]",
          back ? "gap-3.5" : "gap-4.5",
          "lg:px-0 lg:pb-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}
