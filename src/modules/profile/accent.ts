import {
  blend,
  formatOklch,
  oklchToHex,
  walkUntilReadable,
  type Oklch,
} from "@/lib/color/oklch";

/**
 * The accent, as seven names rather than seven colours.
 *
 * Everything in Balancia that is chosen, active or still to do already reads
 * `--primary`, so switching the accent is one token substitution rather than a
 * pass over the app. This module holds the seeds, derives the two things the
 * accent owns that cannot be written as a literal — its ink in each theme —
 * and hands `accentTokens` to whoever is painting the document root.
 *
 * Stored as a name — "mint", not `oklch(0.75 0.13 167)`. A stored colour would
 * pin every account that ever chose one to the exact value it had that day, so
 * retuning the palette would mean a migration; a stored name lets the palette
 * move underneath it. It also means an unknown value is a single check away
 * from the default rather than an arbitrary string reaching a CSS variable.
 *
 * **The money colours are not derived from the accent, and never were meant
 * to be.** Green means somebody owes you, red means you owe and amber marks
 * who paid, in every one of these palettes and on every account: they are
 * written as literals in `globals.css` and nothing here can move them. See
 * the note below on why the accent is allowed to resemble one.
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

export type Theme = "light" | "dark";

/** The three colours in the app that carry a meaning of their own. */
export const MONEY_ROLES = ["negative", "positive", "payer"] as const;

export type MoneyRole = (typeof MONEY_ROLES)[number];

/** Today's `--primary`, so an account that never chose one changes nothing. */
export const DEFAULT_ACCENT: AccentColor = "coral";

/**
 * What each name paints: the fill, from which the inks are derived.
 *
 * One seed per accent rather than a light one and a dark one, because
 * `--primary` has always been the same in both themes here — see the `:root`
 * and `.dark` blocks in `globals.css`. Every one of these sits between 0.70
 * and 0.78 lightness, which is what keeps the plum `--primary-foreground`
 * readable on all seven without a second table.
 *
 * Three of them are a near neighbour of a money colour: coral is two degrees
 * from the "you owe" red, mint is the "gets back" green to the last digit,
 * amber is the payer. That is accepted, on purpose, and it is not fixable —
 * see the note on `accentPalette` below.
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

/**
 * The grounds an ink is read on, per theme: the card, the page, and — for
 * the tinted badge — the card under a wash of the ink's own fill. The same
 * four surfaces `src/app/token-contrast.test.ts` pins, and the test also
 * checks that these literals still match `globals.css`.
 */
export const SURFACES: Record<Theme, { card: Oklch; background: Oklch }> = {
  light: {
    card: { l: 1, c: 0, h: 0 },
    background: { l: 0.977, c: 0.007, h: 85 },
  },
  dark: {
    card: { l: 0.27, c: 0.068, h: 319 },
    background: { l: 0.226, c: 0.072, h: 319 },
  },
};

/** `bg-primary/15` in detail-blocks and transactions, `/18` on the self pill. */
export const TINT_ALPHAS = [0.15, 0.18] as const;

/** WCAG 2.2 1.4.3 for text, and 1.4.6 for the increased-contrast setting. */
export const AA_TEXT = 4.5;
export const AAA_TEXT = 7;

export interface TonePair {
  /** The graphical object: bar, badge wash, button. */
  readonly fill: Oklch;
  /** The same hue as text, at 4.5:1 on every surface it lands on. */
  readonly ink: Oklch;
  /** The same again at 7:1, for a reader who asked for more contrast. */
  readonly inkMore: Oklch;
}

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

/** The grounds `fill` is read on as text, as hexes for the contrast maths. */
export function inkSurfaces(fill: Oklch, theme: Theme): string[] {
  const card = oklchToHex(SURFACES[theme].card);
  return [
    card,
    oklchToHex(SURFACES[theme].background),
    ...TINT_ALPHAS.map((alpha) => blend(oklchToHex(fill), alpha, card)),
  ];
}

/**
 * A fill and its two inks.
 *
 * Light inks walk down from the fill, dark inks walk up: coral at L 0.712 is
 * 2.6:1 on cream and 5.6:1 on the dark card, so the light one has work to do
 * and the dark one often has none. Chroma is fitted at every step, so what
 * comes back is inside sRGB and the same colour in every browser.
 */
export function tonePair(fill: Oklch, theme: Theme): TonePair {
  const surfaces = inkSurfaces(fill, theme);
  const direction = theme === "light" ? "darker" : "lighter";
  return {
    fill,
    ink: walkUntilReadable(fill, surfaces, AA_TEXT, direction),
    inkMore: walkUntilReadable(fill, surfaces, AAA_TEXT, direction),
  };
}

export interface AccentPalette {
  /** The accent itself; `--primary` and the ring. */
  readonly fill: Oklch;
  /** The accent as text, per theme. */
  readonly ink: Record<Theme, Oklch>;
  /** The same at 7:1, for the increased-contrast setting. */
  readonly inkMore: Record<Theme, Oklch>;
}

const THEMES: readonly Theme[] = ["light", "dark"];

const palettes = new Map<AccentColor, AccentPalette>();

/**
 * Everything the accent owns, derived once per name.
 *
 * Which is now only its own two inks: the seed walked down (or up) in
 * lightness until it reads at 4.5:1 on the worst of the surfaces it lands
 * on, which is the method the coral inks in `globals.css` were tuned by hand
 * to. `accent.test.ts` holds the arithmetic to a table.
 *
 * **Why the accent is allowed to resemble a money colour.** It used to be the
 * other way round: a money hue within forty degrees of the accent was rotated
 * away from it. That is what turned "you owe" ruby for the default accent,
 * "gets back" olive for mint, and the payer chartreuse for amber — and it was
 * not a bug in the rule so much as the rule being unsatisfiable. In the dark
 * theme the seeds live at L 0.70–0.78 and the money fills at L 0.72–0.82, and
 * an ink is walked until it clears 4.5:1, so two inks of similar chroma land
 * at the same lightness whatever hue they started from. Lightness and chroma
 * are therefore spoken for, and hue is the only axis left — which needs about
 * thirty degrees to register, which is exactly far enough to stop a red being
 * red. Searching the whole red band finds nothing: the closest a "you owe"
 * can come to being both distinct from coral and still red is a pink.
 *
 * So the promise is not that the accent looks unlike a balance. It is that
 * colour never carries the meaning by itself — every figure has a sign and a
 * word beside it (`src/components/money/balance-tone.ts`) — and that the
 * accent never paints a money surface. That second half is a rule about
 * components, it is written down in `AGENTS.md`, and it was always the half
 * doing the work.
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
  };
  palettes.set(accent, palette);
  return palette;
}

/** The accent's own colour, as `globals.css` would write it. */
export function accentCss(accent: AccentColor): string {
  return formatOklch(ACCENT_SEEDS[accent]);
}

/**
 * The variables the accent actually lives in — six, and no more.
 *
 * `--primary` and `--ring` are the same colour by definition; leaving one
 * behind would give a coral focus ring on a mint button, which reads as a bug
 * rather than as a palette. The sidebar pair is no longer written here: the
 * stylesheet points `--sidebar-primary` and `--sidebar-ring` at these two, so
 * they follow without being said twice. Both are literal values, so every
 * parser that reads a bare `oklch()` — the email test, the token test, the
 * iOS drift script — keeps working.
 *
 * The inks come in a light and a dark form, because an inline declaration
 * cannot tell which theme it is in and the two need different lightness.
 * `globals.css` picks: `:root` reads `--accent-ink-light`, `.dark` reads
 * `--accent-ink-dark`, each with the coral value as its fallback for a
 * document nobody painted.
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
  };
  for (const theme of THEMES) {
    tokens[`--accent-ink-${theme}`] = formatOklch(palette.ink[theme]);
    tokens[`--accent-ink-more-${theme}`] = formatOklch(palette.inkMore[theme]);
  }
  return tokens;
}
