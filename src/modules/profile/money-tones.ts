import {
  blend,
  fitChroma,
  hueDistance,
  oklchToHex,
  walkUntilReadable,
  type Oklch,
} from "@/lib/color/oklch";

/**
 * The money colours, and how they keep their distance from the accent.
 *
 * Green means somebody owes you, red means you owe, amber marks who paid.
 * Those three are the only colours in the app that carry meaning, and the
 * accent is the one colour the reader gets to choose — which is a collision
 * waiting to happen: coral, the default, sits two degrees from the "you owe"
 * red, and mint *is* the "gets back" green to the last digit.
 *
 * Material You resolves the same tension the other way round: it rotates a
 * product's reserved colours a few degrees *toward* the wallpaper's accent so
 * they feel like one palette. Here the meaning matters more than the harmony,
 * so a money hue that lands within `MIN_HUE_SEPARATION` of the accent is
 * rotated *away* until it is that far apart — and only inside the band where
 * it still reads as itself. A "you owe" pushed into orange would stop being
 * red and land on the payer, so it goes to ruby instead; a "gets back" pushed
 * past teal would stop being green, so it goes to grass.
 *
 * Nothing here is stored. The seed is a name, this is arithmetic on it, and
 * `accent.test.ts` holds the arithmetic to a table so a change is a diff.
 */

export type Theme = "light" | "dark";

export type MoneyRole = "negative" | "positive" | "payer";

export const MONEY_ROLES = ["negative", "positive", "payer"] as const;

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

/** `bg-positive/15` in detail-blocks and transactions, `/18` on the self pill. */
export const TINT_ALPHAS = [0.15, 0.18] as const;

/**
 * The money fills as `globals.css` draws them when nothing is rotating them.
 * The dark values are lighter, because a fill on plum owes it 3:1 the same
 * way a fill on cream does.
 */
export const MONEY_BASE: Record<Theme, Record<MoneyRole, Oklch>> = {
  light: {
    negative: { l: 0.639, c: 0.18, h: 32 },
    positive: { l: 0.654, c: 0.13, h: 167 },
    payer: { l: 0.72, c: 0.145, h: 70 },
  },
  dark: {
    negative: { l: 0.72, c: 0.16, h: 32 },
    positive: { l: 0.75, c: 0.13, h: 167 },
    payer: { l: 0.82, c: 0.14, h: 78 },
  },
};

/**
 * How far a money hue keeps from the accent, in degrees.
 *
 * Forty is where two fills of the same lightness and chroma stop reading as
 * one colour drawn twice: at the chroma these tokens carry it is a chord of
 * about 0.09 in OKLab, four or five times the smallest difference an eye
 * separates. Fifteen — Material's harmonising shift — is the distance at
 * which they still look like the same family, which is the opposite of what
 * is wanted here.
 */
export const MIN_HUE_SEPARATION = 40;

/**
 * Where each role still means what it means. A rotation that would leave the
 * band is not offered, whichever side of the accent it falls on.
 */
const BANDS: Record<MoneyRole, readonly [number, number]> = {
  negative: [340, 50],
  positive: [110, 200],
  payer: [40, 115],
};

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

function normalise(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function inBand(hue: number, [from, to]: readonly [number, number]): boolean {
  const h = normalise(hue);
  return from <= to ? h >= from && h <= to : h >= from || h <= to;
}

/**
 * The fill for one role, rotated clear of the accent if it has to be.
 *
 * Exported for the test and the design-system page; `moneyTones` below is
 * what the palette actually calls.
 */
export function divergeMoney(
  role: MoneyRole,
  accentHue: number,
  theme: Theme,
): Oklch {
  const base = MONEY_BASE[theme][role];
  if (hueDistance(base.h, accentHue) >= MIN_HUE_SEPARATION) return base;

  const others = MONEY_ROLES.filter((other) => other !== role).map(
    (other) => MONEY_BASE[theme][other].h,
  );
  const candidates = [
    normalise(accentHue + MIN_HUE_SEPARATION),
    normalise(accentHue - MIN_HUE_SEPARATION),
  ]
    .filter((hue) => inBand(hue, BANDS[role]))
    .map((hue) => ({
      hue,
      room: Math.min(...others.map((other) => hueDistance(hue, other))),
    }))
    .sort((a, b) => b.room - a.room);

  const chosen = candidates[0];
  if (!chosen) {
    throw new Error(
      `No ${role} hue keeps ${MIN_HUE_SEPARATION}° from an accent at ${accentHue}° and stays ${role}.`,
    );
  }
  return fitChroma({ ...base, h: chosen.hue });
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

/** Every money role for one accent hue and theme. */
export function moneyTones(
  accentHue: number,
  theme: Theme,
): Record<MoneyRole, TonePair> {
  return {
    negative: tonePair(divergeMoney("negative", accentHue, theme), theme),
    positive: tonePair(divergeMoney("positive", accentHue, theme), theme),
    payer: tonePair(divergeMoney("payer", accentHue, theme), theme),
  };
}
