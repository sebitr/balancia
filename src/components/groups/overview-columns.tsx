import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The group overview's two columns, from `lg` up.
 *
 * On a phone this is one column and nothing about it shows: the two halves
 * stack with the gap the overview already uses between its blocks, so the
 * screen reads exactly as it did before there were halves at all. From `lg`
 * up — where the sidebar has replaced the bottom bar and the window has
 * room to spare — they stand side by side:
 *
 * - `primary`, on the left, is the money: where the reader stands, the
 *   balances, the repayments that would square the group.
 * - `secondary`, on the right, is the context: what changed since the last
 *   visit, what the group has spent, the way into its history.
 *
 * Primary comes first in the document, which is what keeps the reading order
 * a screen reader and a keyboard follow the same as the one a phone shows. The
 * columns are placed by the grid, never reordered by it.
 *
 * `data-layout="wide"` is how the screen around this knows to make room for
 * it: `<Screen>` widens its column for a screen that holds one, and leaves
 * every other screen — the transactions, the people, the settings — at the
 * one readable width it has always had.
 *
 * A half that renders nothing takes no space and no gap, so the other one
 * starts at the top of the screen rather than a gap's height below it.
 */
export function OverviewColumns({
  primary,
  secondary,
  className,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  /** The vertical gap between blocks, which the overview chooses. */
  className?: string;
}) {
  const column = cn("flex min-w-0 flex-col empty:hidden", className);

  return (
    <div
      data-layout="wide"
      className={cn(
        "flex flex-col lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6",
        className,
      )}
    >
      <div data-slot="overview-primary" className={column}>
        {primary}
      </div>
      <div data-slot="overview-secondary" className={column}>
        {secondary}
      </div>
    </div>
  );
}
