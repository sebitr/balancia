import { cn } from "@/lib/utils";

/**
 * Balancia mark: splitting a bill is division. A dot for what was spent, a
 * rule to divide it, a pan below that catches everyone's share.
 *
 * Two colours and no more — `currentColor` for the rule and pan, `--primary`
 * for the dot. See `design-system/dist/foundations/brand.html` for clear
 * space, minimum sizes and misuse.
 */
export function BalanciaMark({
  className,
  shares = false,
}: {
  className?: string;
  /**
   * Draws the three shares the header's hover animation drops into the pan —
   * see `SplittingWordmark`. They come before the rule so it hides them as
   * they fall, and stay invisible until a `data-splitting` ancestor runs them.
   */
  shares?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-7 overflow-visible", className)}
    >
      <g transform="translate(2.4 2.6) scale(0.85)">
        {shares &&
          ["-4.2px", "0px", "4.2px"].map((dx) => (
            <circle
              key={dx}
              cx="16"
              cy="4.5"
              r="1.9"
              className="brand-mark-share fill-primary"
              style={{ "--share-dx": dx } as React.CSSProperties}
            />
          ))}
        <circle
          cx="16"
          cy="4.5"
          r="4.4"
          className="brand-mark-dot fill-primary"
        />
        <rect
          x="0"
          y="14.75"
          width="32"
          height="4.5"
          rx="2.25"
          fill="currentColor"
        />
        <path
          d="M9.5 25a6.5 6.5 0 0 0 13 0Z"
          fill="currentColor"
          className="brand-mark-pan"
        />
      </g>
    </svg>
  );
}

/**
 * Single-colour mark for stamps, favicons and anywhere the coral dot cannot
 * reproduce. Below 20px the pan and rule merge — prefer this at those sizes.
 */
export function BalanciaMarkMono({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-7", className)}
    >
      <g transform="translate(2.4 2.6) scale(0.85)">
        <circle cx="16" cy="4.5" r="4.4" fill="currentColor" />
        <rect
          x="0"
          y="14.75"
          width="32"
          height="4.5"
          rx="2.25"
          fill="currentColor"
        />
        <path d="M9.5 25a6.5 6.5 0 0 0 13 0Z" fill="currentColor" />
      </g>
    </svg>
  );
}

export function Wordmark({
  className,
  markClassName,
  wordClassName,
  shares,
  ...rest
}: {
  className?: string;
  markClassName?: string;
  /** The word on its own — the marketing header hides it on the narrowest phones. */
  wordClassName?: string;
  shares?: boolean;
} & Omit<React.ComponentProps<"span">, "children">) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} {...rest}>
      <BalanciaMark className={markClassName} shares={shares} />
      <span
        className={cn(
          "font-heading text-lg font-semibold tracking-tight",
          wordClassName,
        )}
      >
        Balancia
      </span>
    </span>
  );
}
