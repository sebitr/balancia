import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blend,
  contrastRatio,
  deltaE,
  oklchToHex,
  parseOklch,
  type Oklch,
} from "@/lib/color/oklch";
import {
  ACCENT_COLORS,
  ACCENT_SEEDS,
  accentPalette,
} from "@/modules/profile/accent";
import { MONEY_ROLES, type Theme } from "@/modules/profile/money-tones";

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
 *
 * What this file sees is the palette as drawn — coral, with the fallbacks
 * the accent-aware tokens carry. The other six accents, and the money
 * colours rotated clear of them, are `src/modules/profile/accent.test.ts`'s
 * job; what is checked here about the accent is that the chart colours keep
 * out of its way, whichever one it is.
 */

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** WCAG 2.2 1.4.3 — normal-size text. */
const AA_TEXT = 4.5;

/**
 * How far apart a chart colour keeps from anything that means money or
 * marks the accent, in OKLab — the floor `accent.test.ts` uses, for the
 * reason it gives there.
 */
const MIN_DELTA_E = 0.075;

const THEMES: readonly [Theme, string][] = [
  ["light", ":root"],
  ["dark", ".dark"],
];

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

/**
 * The ink each chart band carries in `BAND_STYLES`
 * (`src/components/expenses/transactions.tsx`): plum wherever the band is
 * light enough, cream where it is not.
 */
const BAND_INKS: Record<Theme, Record<string, string>> = {
  light: {
    "chart-1": "background",
    "chart-2": "foreground",
    "chart-3": "foreground",
    "chart-4": "foreground",
    "chart-5": "foreground",
  },
  dark: {
    "chart-1": "background",
    "chart-2": "background",
    "chart-3": "background",
    "chart-4": "background",
    "chart-5": "foreground",
  },
};

/** The chart colours that are categorical — everything but the accent. */
const CATEGORICAL_CHARTS = ["chart-1", "chart-3", "chart-4", "chart-5"];

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
    if (!found.has(name)) found.set(name, value!.trim());
  }
  return found;
}

/**
 * A token's value as a colour, following `var()` where the block uses it.
 *
 * `var(--x)` is an alias of another token in the same block; `var(--x, …)`
 * is one the accent may override inline, and what this file wants is the
 * fallback — the palette as drawn.
 */
function resolve(tokens: Map<string, string>, name: string): Oklch {
  const value = tokens.get(name);
  if (!value) throw new Error(`no --${name} declared`);
  const alias = value.match(/^var\(--([a-z0-9-]+)\)$/i);
  if (alias) return resolve(tokens, alias[1]!);
  const withFallback = value.match(/^var\(--[a-z0-9-]+,\s*(.+)\)$/i);
  const literal = withFallback ? withFallback[1]! : value;
  const parsed = parseOklch(literal.replace(/\s*\/\s*[\d.%]+\s*\)$/, ")"));
  if (!parsed) throw new Error(`not a plain oklch() colour: ${value}`);
  return parsed;
}

describe.each(THEMES)("%s theme balance text", (theme, selector) => {
  const tokens = block(selector);
  const colour = (name: string): string => oklchToHex(resolve(tokens, name));

  it("declares an -ink twin for every two-job colour", () => {
    const missing = Object.keys(INK_SURFACES).filter((ink) => !tokens.has(ink));
    expect(missing, `${selector} is missing these tokens`).toEqual([]);
  });

  for (const [ink, surfaces] of Object.entries(INK_SURFACES)) {
    for (const surface of surfaces) {
      it(`--${ink} clears AA as text on ${surface}`, () => {
        // The washes the app puts these inks on: `bg-primary/15` in
        // detail-blocks, `/16` in money-formats, `/18` on the self pill and
        // the accented settings row. Both ends are checked because neither
        // is the strict one in both themes: on cream a heavier wash darkens
        // the ground, which helps dark ink; on the dark card the same wash
        // lightens it, which hurts light ink.
        const grounds =
          surface === "tint"
            ? [0.15, 0.18].map((alpha) =>
                blend(colour(TINT_BASE[ink]!), alpha, colour("card")),
              )
            : [colour(surface)];
        const worst = Math.min(
          ...grounds.map((ground) => contrastRatio(colour(ink), ground)),
        );
        expect(
          Number(worst.toFixed(2)),
          `--${ink} on ${surface} in ${theme}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }
});

describe.each(THEMES)("%s theme chart colours", (theme, selector) => {
  const tokens = block(selector);

  it('draw the "you" series in the accent, whichever it is', () => {
    expect(tokens.get("chart-2")).toBe("var(--primary)");
  });

  it("carry the ink the band styles give them, under every accent", () => {
    for (const [chart, ink] of Object.entries(BAND_INKS[theme])) {
      const fills =
        chart === "chart-2"
          ? ACCENT_COLORS.map((accent) => ACCENT_SEEDS[accent])
          : [resolve(tokens, chart)];
      for (const fill of fills) {
        expect(
          contrastRatio(oklchToHex(fill), oklchToHex(resolve(tokens, ink))),
          `--${ink} on --${chart} ${oklchToHex(fill)} in ${theme}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it.each(CATEGORICAL_CHARTS)(
    "keep --%s clear of every accent and every money colour",
    (chart) => {
      const bar = resolve(tokens, chart);
      for (const accent of ACCENT_COLORS) {
        const palette = accentPalette(accent);
        expect(
          deltaE(bar, palette.fill),
          `--${chart} vs the ${accent} accent in ${theme}`,
        ).toBeGreaterThanOrEqual(MIN_DELTA_E);
        for (const role of MONEY_ROLES) {
          expect(
            deltaE(bar, palette.money[theme][role].fill),
            `--${chart} vs ${role} under ${accent} in ${theme}`,
          ).toBeGreaterThanOrEqual(MIN_DELTA_E);
        }
      }
    },
  );
});
