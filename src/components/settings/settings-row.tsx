import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

/**
 * A row in a settings card, and the shape the whole hub is built from.
 *
 * The value on the right is the point of it. A row that reads
 * "Notifications · All on" answers the question most visits were opened to
 * ask, so the majority of them end without a tap — which is the whole argument
 * for a hub of summaries over three long pages of controls.
 *
 * The icon sits in a tinted tile rather than loose against the label: at 16px
 * a lucide stroke has no weight of its own next to 15px text, and the tile is
 * what gives the column its left edge. Dividers start at that edge too, inset
 * past the tile, so the eye reads a list of labels rather than a stack of
 * boxes.
 */

/** The tile, shared by rows that link and rows that only display. */
function IconTile({
  icon: Icon,
  accent,
}: {
  icon: LucideIcon;
  accent?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7.5 shrink-0 items-center justify-center rounded-[10px]",
        // One row in the hub is tinted, and only one: the way you are paid is
        // the only destination there that is about money leaving somebody
        // else's account rather than about how this one is set up.
        accent ? "bg-primary/18 text-primary-ink" : "bg-foreground/8",
      )}
    >
      <Icon className="size-4" strokeWidth={1.9} />
    </span>
  );
}

interface RowContent {
  readonly icon?: LucideIcon;
  readonly label: string;
  /** The live value, computed from current state. Absent where there is none. */
  readonly summary?: string | null;
  /**
   * A summary that is not words — the overlapping payment marks, an accent
   * dot before the theme's name. Drawn instead of `summary`, and left
   * un-truncated, because a ring around a tile is what `truncate` would clip.
   */
  readonly trailing?: ReactNode;
  /** A badge after the label — "Admin" on the administration row. */
  readonly badge?: ReactNode;
  /** Tints the icon tile with the accent. The payouts row, and only it. */
  readonly accent?: boolean;
}

function RowBody({
  icon,
  label,
  summary,
  trailing,
  badge,
  accent,
  chevron,
}: RowContent & {
  chevron: boolean;
}) {
  return (
    <>
      {icon && <IconTile icon={icon} accent={accent} />}
      {/* Label and summary share one line while they both fit, and the summary
          drops to a second line when they do not.

          Shortening each a little was the previous rule, and it produced rows
          where neither half could be read: French "Connexion et sécurité"
          wants 153px of the 134 it was given, and its "Aucune clé d'accès"
          wants 113 of 99, so the row rendered as two ellipses in a trench
          coat. Wrapping is what `flex-wrap` plus an unshrinkable summary buys:
          a row that fits is untouched and stays 44px tall, and only a row that
          genuinely cannot fit pays a second line — at which point the label
          has the full width and stops truncating at all.

          The label keeps `flex-auto` so that, on the one-line rows, its growth
          is still what pushes the summary to the right edge. */}
      <span className="flex min-w-0 flex-auto flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="flex min-w-0 flex-auto items-center gap-2">
          <span className="truncate text-sm font-medium">{label}</span>
          {badge}
        </span>
        {!trailing && summary && (
          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
            {summary}
          </span>
        )}
      </span>
      {trailing}
      {chevron && (
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={2}
        />
      )}
    </>
  );
}

/**
 * The row's padding and hit area.
 *
 * `min-h-11` is not decoration: every tappable row owes a finger 44px, and the
 * text alone does not always reach it.
 */
const ROW = cn(
  "flex min-h-11 w-full items-center gap-3 px-4 py-3.5 text-left",
  "transition-colors hover:bg-foreground/4 focus-visible:ring-3",
  "focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:-outline-offset-2",
);

/** A row that goes somewhere. */
export function SettingsLinkRow({
  href,
  ...content
}: RowContent & { href: string }) {
  return (
    <Link href={href} transitionTypes={PUSH} className={ROW}>
      <RowBody {...content} chevron />
    </Link>
  );
}

/** A row that does something here, rather than going anywhere. */
export function SettingsButtonRow({
  className,
  chevron = false,
  icon,
  label,
  summary,
  trailing,
  badge,
  accent,
  ...props
}: RowContent &
  ComponentProps<"button"> & {
    /** Set where the button opens a picker rather than acting at once. */
    chevron?: boolean;
  }) {
  return (
    <button type="button" className={cn(ROW, className)} {...props}>
      <RowBody
        icon={icon}
        label={label}
        summary={summary}
        trailing={trailing}
        badge={badge}
        accent={accent}
        chevron={chevron}
      />
    </button>
  );
}

/**
 * A row carrying a control — a switch, a pill button — rather than a
 * destination. The control is the tap target, so the row itself is not one.
 */
export function SettingsControlRow({
  label,
  description,
  htmlFor,
  control,
  className,
}: {
  label: string;
  description?: string;
  /** Ties the label to the control, so tapping the words works too. */
  htmlFor?: string;
  control: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-start justify-between gap-4",
        className,
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <label
          htmlFor={htmlFor}
          className="block text-sm font-medium text-pretty"
        >
          {label}
        </label>
        {description && (
          <p className="text-xs text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}
