/**
 * The accent, as seven names rather than seven colours.
 *
 * Everything in Balancia that is chosen, active or still to do already reads
 * `--primary`, so switching the accent is one token substitution rather than a
 * pass over the app. That is the whole implementation: this module holds the
 * palette, and `accentTokens` hands the three variables that carry it to
 * whoever is painting the document root.
 *
 * Stored as a name — "mint", not `oklch(0.75 0.13 167)`. A stored colour would
 * pin every account that ever chose one to the exact value it had that day, so
 * retuning the palette would mean a migration; a stored name lets the palette
 * move underneath it. It also means an unknown value is a single check away
 * from the default rather than an arbitrary string reaching a CSS variable.
 *
 * **The balance semantics are not in here and must not join it.** Positive,
 * negative and neutral keep `--positive`, `--negative` and `--neutral-balance`
 * whatever the accent is: green means somebody owes you in every one of these
 * palettes, and an accent that could turn it red would make the one colour in
 * the app that carries meaning mean nothing.
 */

export const ACCENT_COOKIE_NAME = "balancia_accent";

export const ACCENT_COLORS = [
  "coral",
  "amber",
  "mint",
  "ocean",
  "lavender",
  "raspberry",
  "plum",
] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

/** Today's `--primary`, so an account that never chose one changes nothing. */
export const DEFAULT_ACCENT: AccentColor = "coral";

/**
 * What each name paints.
 *
 * One value per accent rather than a light one and a dark one, because
 * `--primary` has always been the same in both themes here — see the `:root`
 * and `.dark` blocks in `globals.css`. Every one of these sits between 0.70
 * and 0.78 lightness, which is what keeps the plum `--primary-foreground`
 * readable on all seven without a second table.
 */
export const ACCENT_VALUES: Record<AccentColor, string> = {
  coral: "oklch(0.712 0.168 30)",
  amber: "oklch(0.78 0.13 70)",
  mint: "oklch(0.75 0.13 167)",
  ocean: "oklch(0.71 0.12 235)",
  lavender: "oklch(0.72 0.13 300)",
  raspberry: "oklch(0.7 0.17 350)",
  plum: "oklch(0.71 0.048 319)",
};

export function isAccentColor(value: unknown): value is AccentColor {
  return (
    typeof value === "string" &&
    (ACCENT_COLORS as readonly string[]).includes(value)
  );
}

/** The stored value if it is one we know how to paint, or the default. */
export function resolveAccent(value: unknown): AccentColor {
  return isAccentColor(value) ? value : DEFAULT_ACCENT;
}

/**
 * The three variables the accent actually lives in.
 *
 * `--ring` and `--sidebar-primary` are the same colour by definition in both
 * token blocks; leaving either behind would give a coral focus ring on a mint
 * button, which reads as a bug rather than as a palette.
 *
 * Returned as a plain object so it can go straight into a React `style` prop
 * on `<html>` — an inline declaration outranks both `:root` and `.dark`, which
 * is exactly what a per-account override has to do.
 */
export function accentTokens(accent: AccentColor): Record<string, string> {
  const value = ACCENT_VALUES[accent];
  return {
    "--primary": value,
    "--ring": value,
    "--sidebar-primary": value,
    "--sidebar-ring": value,
  };
}
