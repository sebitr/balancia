"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A row that opens to show what it is talking about.
 *
 * Used on the administration screen for the two things nobody should have to
 * take on trust — the payload that would be sent, and the list of what is
 * never collected. Both are long, both are the point of the screen, and
 * neither should be the first thing on it: a wall of JSON above the switches
 * would bury the controls, and a wall of JSON nobody can reach would be
 * worse.
 *
 * The chevron rotates rather than swapping for a second glyph, so the shape
 * that says "there is more here" is the same shape that says "this is open".
 */
export function Disclosure({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div
      className={cn("not-first:border-t not-first:border-border", className)}
    >
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium transition-colors hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:-outline-offset-2 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-90",
          )}
        />
      </button>
      {/* Unmounted rather than hidden when closed: the payload block is a few
          kilobytes of JSON, and it is not read by anything while it is shut. */}
      {open && (
        <div id={panelId} className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}
