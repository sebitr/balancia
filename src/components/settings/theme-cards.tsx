"use client";

import {
  swatchCss,
  type DarkSurface,
  type LightSurface,
} from "@/modules/profile/surface";
import { SwatchCards } from "./swatch-cards";

/**
 * The three themes, drawn with the surfaces the reader chose for them.
 *
 * "Light" is drawn in cream until Paper is picked one section down, and then
 * in paper; "Auto" is the two of them split down the middle. The values come
 * from the same table the override blocks in `globals.css` are checked
 * against, so the card and the page cannot drift apart.
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
  /** Which light and dark surface the previews are drawn in. */
  surfaces: { light: LightSurface; dark: DarkSurface };
  onChoose: (value: ThemeChoice) => void;
  disabled?: boolean;
}) {
  const light = swatchCss(surfaces.light);
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
