"use client";

import { cn } from "@/lib/utils";

/**
 * One choice among a few, drawn as a pill: filled in the accent when picked,
 * outlined when not.
 *
 * Pressing it writes the choice at once, with no Save button after it, so it is
 * a `button` that is *pressed* (`aria-pressed`) and not a radio that is
 * checked: each chip stands alone, and the group is the caller's to name. Where
 * the choices are mutually exclusive and keyboard arrows should move between
 * them, wrap the set in `rovingChoice` (`roving-choice.ts`) as the screens that
 * need it do.
 *
 * Lived in the export panel until a second screen wanted it.
 */
export function Chip({
  selected,
  label,
  onClick,
  disabled,
  className,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        "tap-target h-8 min-w-16 rounded-full px-3.5 text-xs font-semibold transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "bg-primary text-primary-foreground"
          : "border border-input text-foreground hover:bg-wash-2",
        className,
      )}
    >
      {label}
    </button>
  );
}
