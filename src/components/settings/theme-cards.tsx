"use client";

import { swatchCss, type DarkSurface } from "@/modules/profile/surface";
import { SwatchCards } from "./swatch-cards";

/**
 * The three themes, drawn with the surfaces they are actually lit by.
 *
 * "Light" is always cream — there is only one light palette — and "Dark" is
 * whichever of the two is picked one section down; "Auto" is the pair of them
 * split down the middle. The values come from the same table the override
 * block in `globals.css` is checked against, so the card and the page cannot
 * drift apart.
 */

const THEMES = ["system", "light", "dark"] as const;

export type ThemeChoice = (typeof THEMES)[number];

export function ThemeCards({
  label,
  value,
  choices,
  surfaces,
  onChoose,
  disabled,
}: {
  label: string;
  /** Null until the browser has said which theme it is in. */
  value: ThemeChoice | null;
  choices: Record<ThemeChoice, { label: string; description: string }>;
  /** Which dark surface the previews are drawn in. */
  surfaces: { dark: DarkSurface };
  onChoose: (value: ThemeChoice) => void;
  disabled?: boolean;
}) {
  const light = swatchCss("cream");
  const dark = swatchCss(surfaces.dark);
  const previews: Record<ThemeChoice, { ground: string; bar: string }> = {
    system: {
      ground: `linear-gradient(135deg, ${light.ground} 50%, ${dark.ground} 50%)`,
      bar: "oklch(0.62 0.045 319 / 0.55)",
    },
    light,
    dark,
  };

  return (
    <SwatchCards
      name="theme"
      label={label}
      value={value}
      columns={3}
      items={THEMES.map((theme) => ({
        value: theme,
        label: choices[theme].label,
        description: choices[theme].description,
        ground: previews[theme].ground,
        bar: previews[theme].bar,
      }))}
      onChoose={onChoose}
      disabled={disabled}
    />
  );
}
