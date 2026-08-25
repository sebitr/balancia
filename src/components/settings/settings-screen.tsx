import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { POP } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

/**
 * The chrome every settings screen shares.
 *
 * One surface with two headers. The hub names itself and offers the way out of
 * settings altogether; a detail screen names itself and offers the way back to
 * the hub. Both sit at the top edge and stay there while the column under them
 * scrolls — `sticky` against the page's own scroll rather than a nested
 * scroller, because a scroll container inside the document is what breaks
 * momentum scrolling and the address-bar collapse on iOS.
 *
 * The header is inside the transitioning column on purpose: pushing from the
 * hub to a screen should carry the title with it, the way a native stack does.
 * A header hoisted into the layout would sit still while its own screen slid
 * out from under it.
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
      <header
        className={cn(
          "sticky top-0 z-10 flex items-center gap-2 px-3.5",
          "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
          // A detail title is a row label beside its arrow; the hub's is the
          // page's own name and gets the room to say so.
          back ? "py-2.5" : "pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3",
        )}
      >
        {back && (
          <Link
            href={back.href}
            transitionTypes={POP}
            aria-label={back.label}
            className="flex size-8.5 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/7 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ArrowLeft aria-hidden="true" className="size-4.5" />
          </Link>
        )}
        <h1
          className={cn(
            "min-w-0 flex-1 truncate font-heading font-semibold",
            back ? "text-base" : "text-2xl tracking-tight",
          )}
        >
          {title}
        </h1>
        {close && (
          <Link
            href={close.href}
            aria-label={close.label}
            className="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-foreground/7 text-foreground transition-colors hover:bg-foreground/12 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X aria-hidden="true" className="size-4" strokeWidth={2.2} />
          </Link>
        )}
      </header>

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
