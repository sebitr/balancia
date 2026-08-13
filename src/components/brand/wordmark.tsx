import { cn } from "@/lib/utils";

/**
 * Balancia wordmark: two counterweighted dots on a beam — shared expenses,
 * fairly balanced. Deliberately simple; a real brand mark is not this
 * version's job.
 */
export function BalanciaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-7", className)}
    >
      <path
        d="M16 5v22"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M6 11h20"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="7" cy="18" r="4.5" fill="currentColor" opacity="0.9" />
      <circle cx="25" cy="18" r="4.5" fill="currentColor" opacity="0.55" />
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
      <BalanciaMark className={cn("text-primary", markClassName)} />
      <span className="font-heading text-lg font-semibold tracking-tight">
        Balancia
      </span>
    </span>
  );
}
