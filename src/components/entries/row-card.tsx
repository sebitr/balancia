"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Fields that belong together, in one card.
 *
 * The old form was a column of separate inputs and outlined buttons, and every
 * one of them drew its own box — so nothing said that the description and its
 * category were one thought, or that the date and the repeat rule were
 * another. Grouping them into a card with hairlines between makes the
 * relationship structural instead of a matter of vertical spacing, and it
 * takes a row of borders off the screen.
 *
 * Rows are a fixed height whatever they hold: a text field, a value with a
 * chevron, a switch. A card whose rows changed height with their contents
 * would ripple every time a category was picked.
 */

/** Every row in these cards, so nothing sets its own height. */
const ROW = "flex min-h-[52px] w-full items-center gap-3 px-4";

export function RowCard({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-[17px] bg-card shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** A row that only presents something. */
export function Row({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn(ROW, className)}>{children}</div>;
}

/**
 * A row that opens something.
 *
 * The chevron is drawn here rather than passed in, because a row that leads
 * somewhere must always say so — and the one that forgets is the bug this
 * prevents.
 *
 * The field's name is read out before its value rather than replacing it: a
 * row announced as "Category" alone tells somebody what the control is for and
 * not what it currently says, which is the thing they were checking.
 */
export function RowButton({
  icon: Icon,
  label,
  value,
  muted = false,
  tag,
  className,
  onClick,
}: {
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** The field's name, for anyone not reading the card's shape. */
  label: string;
  value: React.ReactNode;
  /** A placeholder rather than a value — "Add a category". */
  muted?: boolean;
  /** Sits between the value and the chevron: "Detected", and nothing else. */
  tag?: React.ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        ROW,
        "text-left transition-colors active:bg-accent",
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden={true}
          className="size-[18px] shrink-0 text-muted-foreground"
        />
      )}
      <span className="sr-only">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          muted ? "text-muted-foreground" : "font-semibold",
        )}
      >
        {value}
      </span>
      {tag}
      <ChevronRight
        aria-hidden="true"
        className="size-[18px] shrink-0 text-muted-foreground"
      />
    </button>
  );
}
