import { cn } from "@/lib/utils";

/**
 * Balancia mark: splitting a bill is division. A dot for what was spent, a
 * rule to divide it, a pan below that catches everyone's share.
 *
 * Two colours and no more — `currentColor` for the rule and pan, `--primary`
 * for the dot. See `design-system/dist/foundations/brand.html` for clear
 * space, minimum sizes and misuse.
 */
export function BalanciaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-7", className)}
    >
      <g transform="translate(2.4 2.6) scale(0.85)">
        <circle cx="16" cy="4.5" r="4.4" className="fill-primary" />
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
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BalanciaMark className={markClassName} />
      <span className="font-heading text-lg font-semibold tracking-tight">
        Balancia
      </span>
    </span>
  );
}
