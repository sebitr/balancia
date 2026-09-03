"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * A row of choices drawn rather than described.
 *
 * A 52px rectangle of the actual colours answers "what is Midnight?" before
 * the caption under it has been read, and it answers it for somebody who
 * cannot read the caption at all. The accent dot in the corner is the live
 * `--primary`, so every swatch also previews the colour chosen further down.
 *
 * **The previews do not follow the current theme, which is the whole point.**
 * Every other surface in the app reads `--background` and `--card` and
 * changes with the setting; these depict the settings, so they are the one
 * place a literal ground colour belongs.
 */

export interface SwatchItem<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description: string;
  /** A CSS colour or gradient for the ground of the preview. */
  readonly ground: string;
  /** A CSS colour for the card drawn on that ground. */
  readonly bar: string;
}

const COLUMNS = {
  2: "grid-cols-2",
  3: "grid-cols-3",
} as const;

export function SwatchCards<T extends string>({
  name,
  label,
  value,
  items,
  columns,
  onChoose,
  disabled,
}: {
  /** Distinguishes two groups on one screen for assistive technology. */
  name: string;
  label: string;
  /**
   * Null until the choice is known — the theme, until the browser has said
   * which one it is in. Nothing is ringed rather than the wrong card.
   */
  value: T | null;
  items: readonly SwatchItem<T>[];
  columns: keyof typeof COLUMNS;
  onChoose: (value: T) => void;
  disabled?: boolean;
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
        value={value ?? ""}
        disabled={disabled}
        onValueChange={(next) => onChoose(next as T)}
        className={cn("grid gap-2.25", COLUMNS[columns])}
      >
        {items.map((item) => (
          <RadioGroupPrimitive.Item
            key={item.value}
            value={item.value}
            className={cn(
              "flex flex-col gap-2.25 rounded-2xl bg-card px-2.75 pt-2.75 pb-3 text-left",
              "transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50",
              "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
              value === item.value
                ? "ring-[1.5px] ring-primary/65"
                : "ring-1 ring-foreground/10",
            )}
          >
            <span
              aria-hidden="true"
              className="relative block h-13 overflow-hidden rounded-[10px]"
              style={{ background: item.ground }}
            >
              <span
                className="absolute inset-x-1.75 top-2.5 block h-3.5 rounded-[5px]"
                style={{ background: item.bar }}
              />
              <span className="absolute bottom-2.25 left-1.75 block size-3.5 rounded-full bg-primary" />
            </span>
            <span className="flex flex-col gap-px">
              <span className="truncate text-sm font-semibold">
                {item.label}
              </span>
              <span className="text-2xs leading-tight text-muted-foreground">
                {item.description}
              </span>
            </span>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
    </section>
  );
}
