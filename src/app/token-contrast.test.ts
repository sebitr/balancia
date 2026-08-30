import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The balance colours have to be readable as text, in both themes.
 *
 * `--positive`, `--negative`, `--payer`, `--neutral-balance` and `--primary`
 * each do two jobs. As a *fill* — the balance bar, the tinted badge, the coral
 * button — they are graphical objects, and 3:1 is what they owe their
 * background. As *text* — a balance figure, a "See all" link — they owe 4.5:1,
 * and the palette as drawn does not have it on cream: coral reads 5.6:1 on the
 * dark card and 2.6:1 on the light one. Same value, and only one theme is fine.
 *
 * So each has an `-ink` twin, and this file is why the two cannot drift back
 * together. Every `-ink` token is checked against every surface it is actually
 * rendered on, in the theme that defines it. The plain tokens are deliberately
 * not checked here: they are fills, they are held to a different rule, and
 * writing one assertion over both is how the split gets lost again.
 *
 * The ratios are computed from the tokens in `globals.css` rather than from a
 * table copied beside them, because a table is a second place to forget.
 */

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** WCAG 2.2 1.4.3 — normal-size text. */
const AA_TEXT = 4.5;

/** The `-ink` tokens, and the surfaces each one is rendered on. */
const INK_SURFACES: Record<string, readonly string[]> = {
  // Balance figures sit on cards and on the page; the tinted badges in
  // detail-blocks and transactions put them on a wash of their own fill.
  "positive-ink": ["card", "background", "tint"],
  "negative-ink": ["card", "background", "tint"],
  "payer-ink": ["card", "background", "tint"],
  // position-card draws the settled row on --muted.
  "neutral-balance-ink": ["card", "background", "muted"],
  // Links, active nav labels and check glyphs; also the /15 and /18 washes on
  // the self pill and the money-format badges.
  "primary-ink": ["card", "background", "tint"],
};

/** The fill each ink token's `tint` surface is a wash of. */
const TINT_BASE: Record<string, string> = {
  "positive-ink": "positive",
  "negative-ink": "negative",
  "payer-ink": "payer",
  "primary-ink": "primary",
};

type Rgb = readonly [number, number, number];

/** The declarations inside one selector's block, as a token → value map. */
function block(selector: string): Map<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const end = CSS.indexOf("\n}", start);
  const body = CSS.slice(start, end);
  const found = new Map<string, string>();
  for (const [, name, value] of body.matchAll(
    /^\s*--([a-z0-9-]+):\s*([^;]+);/gim,
  )) {
    // First wins: a token is declared once per block, and the marketing
    // values further down never shadow a product one.
    if (!found.has(name)) found.set(name, value.trim());
  }
  return found;
}

function oklchToRgb(value: string): Rgb {
  const match = value.match(
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.%]+)?\s*\)/i,
  );
  if (!match) throw new Error(`not a plain oklch() colour: ${value}`);
  const [L, C, hue] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ] as const;

  const a = C * Math.cos((hue * Math.PI) / 180);
  const b = C * Math.sin((hue * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel)));

  // Back to gamma sRGB, which is the space a browser composites alpha in.
  return linear.map((channel) =>
    channel > 0.0031308
      ? 1.055 * channel ** (1 / 2.4) - 0.055
      : 12.92 * channel,
  ) as unknown as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The washes the app puts these inks on: `bg-primary/15` in detail-blocks,
 * `/16` in money-formats, `/18` on the self pill and the accented settings row.
 *
 * Both ends are checked because neither is the strict one in both themes. On
 * cream a heavier wash darkens the ground, which helps dark ink; on the dark
 * card the same wash lightens it, which hurts light ink. So the pair is tested
 * and the worse of the two has to clear AA.
 */
const TINT_ALPHAS = [0.15, 0.18] as const;

/** A wash of `fill` over `over`, the way `bg-positive/15` renders. */
function wash(fill: Rgb, over: Rgb, alpha: number): Rgb {
  return fill.map(
    (channel, index) => channel * alpha + over[index] * (1 - alpha),
  ) as unknown as Rgb;
}

describe.each([
  ["light", ":root"],
  ["dark", ".dark"],
])("%s theme balance text", (theme, selector) => {
  const tokens = block(selector);
  const colour = (name: string): Rgb => {
    const value = tokens.get(name);
    if (!value) throw new Error(`${selector} declares no --${name}`);
    return oklchToRgb(value);
  };

  it("declares an -ink twin for every two-job colour", () => {
    const missing = Object.keys(INK_SURFACES).filter((ink) => !tokens.has(ink));
    expect(missing, `${selector} is missing these tokens`).toEqual([]);
  });

  for (const [ink, surfaces] of Object.entries(INK_SURFACES)) {
    for (const surface of surfaces) {
      it(`--${ink} clears AA as text on ${surface}`, () => {
        const grounds =
          surface === "tint"
            ? TINT_ALPHAS.map((alpha) =>
                wash(colour(TINT_BASE[ink]!), colour("card"), alpha),
              )
            : [colour(surface)];
        const worst = Math.min(
          ...grounds.map((ground) => contrast(colour(ink), ground)),
        );
        expect(
          Number(worst.toFixed(2)),
          `--${ink} on ${surface} in ${theme}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }
});
