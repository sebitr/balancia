import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The two containers the settings screens are made of.
 *
 * `SettingsGroup` is the hub's unit: a small uppercase label sitting outside a
 * card of rows. The label is outside because it names a *set of destinations*
 * rather than titling a panel — "You", "How it reads" — and a caption inside
 * the card would read as the first row of it.
 *
 * `SettingsCard` is the detail screens' unit: a title inside the card, because
 * there it does title the panel under it.
 */

/** The card surface itself — `Card`'s ring and radius, without its flex column. */
const SURFACE = "overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10";

/**
 * Rows in a card, hairline-separated from the label edge inwards.
 *
 * The inset matters more than it looks: a divider running the full width cuts
 * the icon column too, and the list stops reading as one column of labels. It
 * is drawn as a pseudo-element over the row rather than as its border, so the
 * row keeps its own box and the rule can start 58px in — the gutter, the tile
 * and the gap after it — without either of them moving.
 */
const DIVIDED = cn(
  "[&>*+*]:relative",
  "[&>*+*]:before:pointer-events-none [&>*+*]:before:absolute",
  "[&>*+*]:before:inset-x-0 [&>*+*]:before:top-0 [&>*+*]:before:ml-[58px]",
  "[&>*+*]:before:border-t [&>*+*]:before:border-border",
);

export function SettingsRows({ children }: { children: ReactNode }) {
  return <div className={DIVIDED}>{children}</div>;
}

export function SettingsGroup({
  label,
  children,
}: {
  /** The uppercase caption above the card. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex shrink-0 flex-col gap-2">
      {label && (
        <h2 className="px-1.5 text-2xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">
          {label}
        </h2>
      )}
      <div className={SURFACE}>{children}</div>
    </section>
  );
}

export function SettingsCard({
  title,
  description,
  children,
  footer,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  children?: ReactNode;
  /** Sits below a hairline — where a card's one action goes. */
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn(SURFACE, "shrink-0", className)}>
      {(title || description) && (
        <div className="space-y-1 px-4 pt-4">
          {title && (
            <h2 className="font-heading text-base font-semibold">{title}</h2>
          )}
          {description && (
            <p className="text-xs text-pretty text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      )}
      {/* A title already carries the top inset, so the content only closes the
          gap under it rather than opening a second one. */}
      {children && (
        <div
          className={cn(
            "px-4 pb-4",
            title || description ? "pt-3" : "pt-4",
            contentClassName,
          )}
        >
          {children}
        </div>
      )}
      {footer && (
        <div className="border-t border-border px-4 py-3.5">{footer}</div>
      )}
    </section>
  );
}
