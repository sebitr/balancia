"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * The three themes, drawn rather than described.
 *
 * A 52px rectangle of the actual colours answers "what is Prune profond?"
 * before the caption under it has been read, and it answers it for somebody
 * who cannot read the caption at all. The accent dot in the corner is the live
 * `--primary`, so the swatch also previews the colour chosen one card down.
 *
 * **The previews do not follow the current theme, which is the whole point.**
 * Every other surface in the app reads `--background` and `--card` and changes
 * with the setting; these three depict the settings, so they are the one place
 * the literal cream and plum belong. They are the same values `:root` and
 * `.dark` carry in `globals.css` — the light bar is a touch lighter than dark
 * `--card`, because at 52px the card has to separate from the ground behind it.
 */

const THEMES = ["system", "light", "dark"] as const;

export type ThemeChoice = (typeof THEMES)[number];

/** Cream, plum, and the surface each draws a card on. See the note above. */
const PREVIEWS: Record<ThemeChoice, { ground: string; bar: string }> = {
  system: {
    ground:
      "linear-gradient(135deg, oklch(0.977 0.007 85) 50%, oklch(0.226 0.072 319) 50%)",
    bar: "oklch(0.62 0.045 319 / 0.55)",
  },
  light: { ground: "oklch(0.977 0.007 85)", bar: "oklch(1 0 0)" },
  dark: { ground: "oklch(0.226 0.072 319)", bar: "oklch(0.32 0.07 319)" },
};

export function ThemeCards({
  label,
  value,
  choices,
  onChoose,
  disabled,
}: {
  label: string;
  /**
   * Null until the browser has said which theme it is in. Nothing is ringed
   * rather than the wrong card being ringed — the choice lives in local
   * storage and the server render cannot know it.
   */
  value: ThemeChoice | null;
  choices: Record<ThemeChoice, { label: string; description: string }>;
  onChoose: (value: ThemeChoice) => void;
  disabled?: boolean;
}) {
  return (
    <section className="flex shrink-0 flex-col gap-2.25">
      <h2
        id="theme-label"
        className="px-1.5 text-2xs font-semibold tracking-[0.11em] text-muted-foreground uppercase"
      >
        {label}
      </h2>
      <RadioGroupPrimitive.Root
        aria-labelledby="theme-label"
        value={value ?? ""}
        disabled={disabled}
        onValueChange={(next) => onChoose(next as ThemeChoice)}
        className="grid grid-cols-3 gap-2.25"
      >
        {THEMES.map((theme) => (
          <RadioGroupPrimitive.Item
            key={theme}
            value={theme}
            className={cn(
              "flex flex-col gap-2.25 rounded-2xl bg-card px-2.75 pt-2.75 pb-3 text-left",
              "transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50",
              "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
              value === theme
                ? "ring-[1.5px] ring-primary/65"
                : "ring-1 ring-foreground/10",
            )}
          >
            <span
              aria-hidden="true"
              className="relative block h-13 overflow-hidden rounded-[10px]"
              style={{ background: PREVIEWS[theme].ground }}
            >
              <span
                className="absolute inset-x-1.75 top-2.5 block h-3.5 rounded-[5px]"
                style={{ background: PREVIEWS[theme].bar }}
              />
              <span className="absolute bottom-2.25 left-1.75 block size-3.5 rounded-full bg-primary" />
            </span>
            <span className="flex flex-col gap-px">
              <span className="truncate text-sm font-semibold">
                {choices[theme].label}
              </span>
              <span className="text-2xs leading-tight text-muted-foreground">
                {choices[theme].description}
              </span>
            </span>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
    </section>
  );
}
