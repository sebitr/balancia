import { formatOklch, type Oklch } from "@/lib/color/oklch";
import {
  MONEY_ROLES,
  moneyTones,
  tonePair,
  type MoneyRole,
  type Theme,
  type TonePair,
} from "./money-tones";

/**
 * The accent, as seven names rather than seven colours.
 *
 * Everything in Balancia that is chosen, active or still to do already reads
 * `--primary`, so switching the accent is one token substitution rather than a
 * pass over the app. This module holds the seeds, derives everything the
 * accent owns from them, and hands `accentTokens` to whoever is painting the
 * document root.
 *
 * Stored as a name — "mint", not `oklch(0.75 0.13 167)`. A stored colour would
 * pin every account that ever chose one to the exact value it had that day, so
 * retuning the palette would mean a migration; a stored name lets the palette
 * move underneath it. It also means an unknown value is a single check away
 * from the default rather than an arbitrary string reaching a CSS variable.
 *
 * **The balance colours are not chosen here; they are kept away from what
 * is.** Green means somebody owes you and red means you owe, in every one of
 * these palettes — so when an accent lands on one of them, it is the money
 * colour that steps aside, by the rule in `money-tones.ts`. What the accent
 * gets is the rest: the button, the ring, the links and ticks (`--primary-ink`,
 * computed per theme rather than copied from coral), and the "you" series in
 * a chart.
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
 * What each name paints: the fill, from which everything else is derived.
 *
 * One seed per accent rather than a light one and a dark one, because
 * `--primary` has always been the same in both themes here — see the `:root`
 * and `.dark` blocks in `globals.css`. Every one of these sits between 0.70
 * and 0.78 lightness, which is what keeps the plum `--primary-foreground`
 * readable on all seven without a second table.
 */
export const ACCENT_SEEDS: Record<AccentColor, Oklch> = {
  coral: { l: 0.712, c: 0.168, h: 30 },
  amber: { l: 0.78, c: 0.13, h: 70 },
  mint: { l: 0.75, c: 0.13, h: 167 },
  ocean: { l: 0.71, c: 0.12, h: 235 },
  lavender: { l: 0.72, c: 0.13, h: 300 },
  raspberry: { l: 0.7, c: 0.17, h: 350 },
  plum: { l: 0.71, c: 0.048, h: 319 },
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

export interface AccentPalette {
  /** The accent itself; `--primary` and the ring. */
  readonly fill: Oklch;
  /** The accent as text, per theme. */
  readonly ink: Record<Theme, Oklch>;
  /** The same at 7:1, for the increased-contrast setting. */
  readonly inkMore: Record<Theme, Oklch>;
  /** The money colours, rotated clear of this accent where they had to be. */
  readonly money: Record<Theme, Record<MoneyRole, TonePair>>;
}

const THEMES: readonly Theme[] = ["light", "dark"];

const palettes = new Map<AccentColor, AccentPalette>();

/**
 * Everything the accent owns, derived once per name.
 *
 * Computed rather than tabulated: the inks are the seed walked in lightness
 * until they read at 4.5:1 on the worst of the surfaces they land on, which
 * is the method the coral inks in `globals.css` were tuned by hand to, and
 * the money colours are `moneyTones` on the seed's hue. Tabulating the
 * result would mean eighty-odd numbers that nobody could tell were still
 * right; `accent.test.ts` holds the arithmetic to a table instead.
 */
export function accentPalette(accent: AccentColor): AccentPalette {
  const known = palettes.get(accent);
  if (known) return known;

  const seed = ACCENT_SEEDS[accent];
  const own = { light: tonePair(seed, "light"), dark: tonePair(seed, "dark") };
  const palette: AccentPalette = {
    fill: seed,
    ink: { light: own.light.ink, dark: own.dark.ink },
    inkMore: { light: own.light.inkMore, dark: own.dark.inkMore },
    money: {
      light: moneyTones(seed.h, "light"),
      dark: moneyTones(seed.h, "dark"),
    },
  };
  palettes.set(accent, palette);
  return palette;
}

/** The accent's own colour, as `globals.css` would write it. */
export function accentCss(accent: AccentColor): string {
  return formatOklch(ACCENT_SEEDS[accent]);
}

/**
 * The variables the accent actually lives in.
 *
 * `--primary`, `--ring` and `--sidebar-primary` are the same colour by
 * definition in both token blocks; leaving one behind would give a coral
 * focus ring on a mint button, which reads as a bug rather than as a palette.
 * They are literal values, so every parser that reads a bare `oklch()` —
 * the email test, the token test, the iOS drift script — keeps working.
 *
 * The rest come in a light and a dark form, because an inline declaration
 * cannot tell which theme it is in and the two need different lightness.
 * `globals.css` picks: `:root` reads `--accent-ink-light`, `.dark` reads
 * `--accent-ink-dark`, each with the coral value as its fallback for a
 * document nobody painted. Every key is always emitted, unmoved money roles
 * included, so painting and rolling back are the same operation.
 *
 * Returned as a plain object so it can go straight into a React `style` prop
 * on `<html>` — an inline declaration outranks both `:root` and `.dark`, which
 * is exactly what a per-account override has to do.
 */
export function accentTokens(accent: AccentColor): Record<string, string> {
  const palette = accentPalette(accent);
  const fill = formatOklch(palette.fill);
  const tokens: Record<string, string> = {
    "--primary": fill,
    "--ring": fill,
    "--sidebar-primary": fill,
    "--sidebar-ring": fill,
  };
  for (const theme of THEMES) {
    tokens[`--accent-ink-${theme}`] = formatOklch(palette.ink[theme]);
    tokens[`--accent-ink-more-${theme}`] = formatOklch(palette.inkMore[theme]);
    for (const role of MONEY_ROLES) {
      const tone = palette.money[theme][role];
      tokens[`--accent-${role}-${theme}`] = formatOklch(tone.fill);
      tokens[`--accent-${role}-ink-${theme}`] = formatOklch(tone.ink);
      tokens[`--accent-${role}-ink-more-${theme}`] = formatOklch(tone.inkMore);
    }
  }
  return tokens;
}
