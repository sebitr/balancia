"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A card of mutually exclusive choices — today, the language.
 *
 * Drawn as a list of rows with a tick rather than as rows with radio dots. At
 * this size a dot is a 16px target inside a 44px row, and the row is what
 * people actually aim at; the tick says which one is current without pretending
 * to be the control. Radix still provides the control underneath, so arrow keys
 * move through the list and a screen reader hears a radio group.
 *
 * The tick's slot is always occupied and only its colour changes. Rendering it
 * conditionally would let every label shift sideways as the selection moves,
 * which reads as the list twitching each time it is used.
 *
 * Selecting writes immediately — there is no Save button anywhere in settings —
 * so `onChoose` is called with the new value and nothing is said back. The tick
 * moving is the confirmation and the row above or below is the way back, one
 * tap away; see `toastUndoable` for where a confirmation does earn its place.
 *
 * The caption sits outside the card, the way `SettingsGroup`'s does and the
 * way the theme and accent sections on the same screen do: it names a set of
 * choices rather than titling a panel, and inside the card it read as the
 * first row of the list.
 */

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  /** What the choice actually produces: "Cream and plum", "13/08/2026". */
  readonly description?: string;
}

export function ChoiceCard<T extends string>({
  label,
  value,
  choices,
  onChoose,
  disabled,
  name,
}: {
  /** The uppercase caption inside the card. */
  label: string;
  /**
   * Null where the current choice is not known yet — the theme, until the
   * browser has read its own storage. Nothing is ticked rather than something
   * being ticked wrongly.
   */
  value: T | null;
  choices: readonly Choice<T>[];
  onChoose: (value: T) => void;
  disabled?: boolean;
  /** Distinguishes two groups on one screen for assistive technology. */
  name: string;
}) {
  return (
    <section className="flex shrink-0 flex-col gap-2.25">
      <h2
        id={`${name}-label`}
        className="px-1.5 text-2xs font-semibold tracking-[0.11em] text-muted-foreground uppercase"
      >
        {label}
      </h2>
      <RadioGroupPrimitive.Root
        aria-labelledby={`${name}-label`}
        // Radix wants a string; "" matches no item, which is exactly the
        // "nothing chosen yet" state and keeps the group controlled.
        value={value ?? ""}
        disabled={disabled}
        onValueChange={(next) => onChoose(next as T)}
        className="flex flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10"
      >
        {choices.map((choice, index) => (
          <RadioGroupPrimitive.Item
            key={choice.value}
            value={choice.value}
            className={cn(
              "flex min-h-13 w-full items-center gap-3 px-4 py-3 text-left",
              "transition-colors hover:bg-wash-1 focus-visible:ring-3",
              "focus-visible:ring-ring/50 focus-visible:-outline-offset-2 focus-visible:outline-none",
              "disabled:pointer-events-none disabled:opacity-50",
              index > 0 && "border-t border-border",
            )}
          >
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="block truncate text-sm font-medium">
                {choice.label}
              </span>
              {choice.description && (
                <span className="block truncate text-xs text-muted-foreground">
                  {choice.description}
                </span>
              )}
            </span>
            {/* Always here, so nothing moves when the choice does. */}
            <Check
              aria-hidden="true"
              className={cn(
                "size-5 shrink-0",
                choice.value === value
                  ? "text-primary-ink"
                  : "text-transparent",
              )}
            />
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
    </section>
  );
}
