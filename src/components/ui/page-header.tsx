import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { POP } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

/**
 * The line a screen opens with: what this is, and the way back out of it.
 *
 * One row, and the arrow is part of the title rather than a control floating
 * above it — the settings hub's screens were drawn this way first and it is
 * the shape every pushed screen now uses. A "← Back" button on its own line
 * said only that there was a way back; it never said where you had landed, and
 * it cost a whole row to say it.
 *
 * Two shapes, and which one you get follows from the arrow:
 *
 *   with a back arrow — the title is a row label beside it, `text-base`, the
 *     way a native stack titles a screen it pushed.
 *   without one — the title is the page's own name and gets the room to say
 *     so, `text-2xl`.
 *
 * So a screen does not choose a size; it says whether it is somewhere you
 * arrived from somewhere else. Which is also why the back link always carries
 * `POP`: this is the way *out*, and it is the one motion that never depends on
 * where the link points.
 *
 * The header carries no padding of its own. It sits in whatever column its
 * screen already has — `<Screen>`'s for a page inside the app shell, and the
 * settings surface's own gutter for the screens that draw to the top edge —
 * and `className` is where a surface that needs to stick, or to clear a safe
 * area, says so.
 */
export function PageHeader({
  title,
  back,
  trailing,
  className,
}: {
  /**
   * What this screen is. Omitted only by a screen that opens with a hero
   * naming itself — repeating the name a centimetre above it is not a title,
   * it is an echo.
   */
  title?: string;
  /** The way back. Its label is what a screen reader announces on the arrow. */
  back?: { href: string; label: string };
  /** A control at the far end of the row. `<PageHeaderClose>`, or nothing. */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-center gap-2", className)}>
      {back && (
        <Link
          href={back.href}
          transitionTypes={POP}
          aria-label={back.label}
          className="tap-target flex size-8.5 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-wash-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeft aria-hidden="true" className="size-4.5" />
        </Link>
      )}

      {/* Untitled, the row still has to hold its height and push the trailing
          control to the far end, so the space stays even when nothing fills it. */}
      {title === undefined ? (
        <span aria-hidden="true" className="min-h-8.5 flex-1" />
      ) : (
        <h1
          className={cn(
            "min-w-0 flex-1 truncate font-heading font-semibold",
            back ? "text-base" : "text-2xl tracking-tight",
          )}
        >
          {title}
        </h1>
      )}

      {trailing}
    </header>
  );
}

/**
 * The way out of a surface, rather than back one step inside it.
 *
 * Filled where the arrow is bare, because it does something different: an
 * arrow returns to the screen behind this one, a ✕ closes the whole surface.
 * Settings is the only place that has one.
 */
export function PageHeaderClose({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="tap-target flex size-8.5 shrink-0 items-center justify-center rounded-full bg-wash-2 text-foreground transition-colors hover:bg-wash-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <X aria-hidden="true" className="size-4" strokeWidth={2.2} />
    </Link>
  );
}
