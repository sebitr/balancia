import type { ReactNode } from "react";
import { PageHeader, PageHeaderClose } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

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
  /** The way out of settings. The hub's ✕, and only the hub's. */
  close?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader
        title={title}
        back={back}
        trailing={close && <PageHeaderClose {...close} />}
        className={cn(
          "sticky top-0 z-10 px-3.5",
          "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
          // A detail title is a row label beside its arrow; the hub's is the
          // page's own name and gets the room to say so.
          back ? "py-2.5" : "pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3",
        )}
      />

      {/* The bottom inset clears the iOS home indicator. The hub spaces its
          labelled groups further apart than a detail screen spaces its cards. */}
      <div
        className={cn(
          "flex flex-1 flex-col px-3.5 pb-[calc(1.625rem+env(safe-area-inset-bottom))]",
          back ? "gap-3.5" : "gap-4.5",
        )}
      >
        {children}
      </div>
    </div>
  );
}
