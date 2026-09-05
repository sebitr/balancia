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
  MONEY_ROLES,
  type Theme,
} from "@/modules/profile/accent";

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
 * Two themes, one light palette, two dark ones, and the system's contrast
 * preference on top of either: six cascades, and every ink is checked in all
 * of them. Under increased contrast the bar is 7:1, and the captions and the
 * lines that it exists for are checked too.
 *
 * What this file sees is the palette as drawn — coral, with the fallback the
 * one accent-aware token carries. The other six accents are
 * `src/modules/profile/accent.test.ts`'s job; what is checked here about the
 * accent is that the chart colours keep out of its way, whichever one it is.
 */

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** WCAG 2.2 1.4.3 — normal-size text; 1.4.6 for the increased setting. */
const AA_TEXT = 4.5;
const AAA_TEXT = 7;
/** WCAG 2.2 1.4.11 — a boundary that has to be seen. */
const AA_GRAPHIC = 3;

/**
 * How far apart a chart colour keeps from anything that means money or
 * marks the accent, in OKLab — the floor `accent.test.ts` uses, for the
 * reason it gives there.
 */
const MIN_DELTA_E = 0.075;

const MIDNIGHT = '.dark[data-dark="midnight"]';
// Inside `@media (prefers-contrast: more)`, which is why `block()` below has
// to count braces rather than stop at the first one in column zero.
const LIGHT_MORE = ":root:not(.dark)";
const DARK_MORE = ":root.dark";

interface Cascade {
  readonly name: string;
  readonly theme: Theme;
  /** The blocks that apply, in the order the stylesheet applies them. */
  readonly selectors: readonly string[];
  readonly more: boolean;
}

const CASCADES: readonly Cascade[] = [
  { name: "light, cream", theme: "light", selectors: [":root"], more: false },
  {
    name: "light, cream, more contrast",
    theme: "light",
    selectors: [":root", LIGHT_MORE],
    more: true,
  },
  { name: "dark, plum", theme: "dark", selectors: [".dark"], more: false },
  {
    name: "dark, midnight",
    theme: "dark",
    selectors: [".dark", MIDNIGHT],
    more: false,
  },
  {
    name: "dark, plum, more contrast",
    theme: "dark",
    selectors: [".dark", DARK_MORE],
    more: true,
  },
  {
    name: "dark, midnight, more contrast",
    theme: "dark",
    selectors: [".dark", MIDNIGHT, DARK_MORE],
    more: true,
  },
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
  // Validation notes and the destructive rows in recurrence-sheet,
  // settle-blocks and split-sheet; the /10 and /15 washes put it on its own.
  "destructive-ink": ["card", "background", "tint"],
};

/** The fill each ink token's `tint` surface is a wash of. */
const TINT_BASE: Record<string, string> = {
  "positive-ink": "positive",
  "negative-ink": "negative",
  "payer-ink": "payer",
  "primary-ink": "primary",
  "destructive-ink": "destructive",
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

/**
 * The declarations inside one selector's block, as a token → value map.
 *
 * The end of the block is found by counting braces rather than by looking for
 * the next `}` in column zero: the contrast blocks live inside
 * `@media (prefers-contrast: more)`, so theirs is indented, and a scan that
 * stopped at the first unindented one would swallow the media query's own
 * closing brace and every declaration in between. The opening is matched at
 * the start of a line for a related reason — `.dark {` is a substring of
 * `:root.dark {`, and a plain indexOf would find the wrong one.
 */
function block(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opening = new RegExp(`^[ \\t]*${escaped} \\{`, "m").exec(CSS);
  if (!opening) throw new Error(`no ${selector} block in globals.css`);
  const start = opening.index;
  let depth = 0;
  let end = start;
  for (let i = start; i < CSS.length; i += 1) {
    if (CSS[i] === "{") depth += 1;
    else if (CSS[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
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

/** The blocks of a cascade merged, later ones overriding earlier ones. */
function cascade(selectors: readonly string[]): Map<string, string> {
  const merged = new Map<string, string>();
  for (const selector of selectors) {
    for (const [name, value] of block(selector)) merged.set(name, value);
  }
  return merged;
}

/**
 * A token's value as a colour and an alpha, following `var()` where the
 * block uses it.
 *
 * `var(--x)` is an alias of another token in the same block; `var(--x, …)`
 * is one the accent may override inline, and what this file wants is the
 * fallback — the palette as drawn.
 */
function resolve(
  tokens: Map<string, string>,
  name: string,
): { color: Oklch; alpha: number } {
  const value = tokens.get(name);
  if (!value) throw new Error(`no --${name} declared`);
  const alias = value.match(/^var\(--([a-z0-9-]+)\)$/i);
  if (alias) return resolve(tokens, alias[1]!);
  const withFallback = value.match(/^var\(--[a-z0-9-]+,\s*(.+)\)$/i);
  const literal = withFallback ? withFallback[1]! : value;
  const alphaMatch = literal.match(/\/\s*([\d.]+)(%?)\s*\)$/);
  const alpha = alphaMatch
    ? Number(alphaMatch[1]) / (alphaMatch[2] ? 100 : 1)
    : 1;
  const parsed = parseOklch(literal.replace(/\s*\/\s*[\d.%]+\s*\)$/, ")"));
  if (!parsed) throw new Error(`not a plain oklch() colour: ${value}`);
  return { color: parsed, alpha };
}

describe.each(CASCADES)("$name", ({ theme, selectors, more }) => {
  const tokens = cascade(selectors);
  /** A token as the hex it paints, composited over `over` if translucent. */
  const colour = (name: string, over = "card"): string => {
    const { color, alpha } = resolve(tokens, name);
    const hex = oklchToHex(color);
    return alpha < 1
      ? blend(hex, alpha, oklchToHex(resolve(tokens, over).color))
      : hex;
  };
  const textFloor = more ? AAA_TEXT : AA_TEXT;

  it("declares an -ink twin for every two-job colour", () => {
    const missing = Object.keys(INK_SURFACES).filter((ink) => !tokens.has(ink));
    expect(missing, `${selectors.join(" ")} is missing these tokens`).toEqual(
      [],
    );
  });

  for (const [ink, surfaces] of Object.entries(INK_SURFACES)) {
    for (const surface of surfaces) {
      it(`--${ink} reads as text on ${surface} at ${textFloor}:1`, () => {
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
          `--${ink} on ${surface}`,
        ).toBeGreaterThanOrEqual(textFloor);
      });
    }
  }

  it(`--muted-foreground reads as a caption at ${textFloor}:1`, () => {
    for (const surface of ["card", "background"]) {
      expect(
        contrastRatio(colour("muted-foreground"), colour(surface)),
        `on ${surface}`,
      ).toBeGreaterThanOrEqual(textFloor);
    }
  });

  if (more) {
    it("draws a border that can be seen", () => {
      for (const surface of ["card", "background"]) {
        expect(
          contrastRatio(colour("border", surface), colour(surface)),
          `--border on ${surface}`,
        ).toBeGreaterThanOrEqual(AA_GRAPHIC);
      }
    });
  }

  it("keeps the page and the card apart, or the card ringed", () => {
    // A card separates from the page by tone or by its ring; the ring is
    // `ring-foreground/10`, so what is asserted is only that the two are
    // not the same colour on a surface that relies on tone.
    expect(colour("card")).not.toBe(colour("background"));
  });

  describe("chart colours", () => {
    it('draw the "you" series in the accent, whichever it is', () => {
      expect(tokens.get("chart-2")).toBe("var(--primary)");
    });

    it("carry the ink the band styles give them, under every accent", () => {
      for (const [chart, ink] of Object.entries(BAND_INKS[theme])) {
        const fills =
          chart === "chart-2"
            ? ACCENT_COLORS.map((accent) => ACCENT_SEEDS[accent])
            : [resolve(tokens, chart).color];
        for (const fill of fills) {
          expect(
            contrastRatio(oklchToHex(fill), colour(ink)),
            `--${ink} on --${chart} ${oklchToHex(fill)}`,
          ).toBeGreaterThanOrEqual(AA_TEXT);
        }
      }
    });

    it.each(CATEGORICAL_CHARTS)(
      "keep --%s clear of every accent and every money colour",
      (chart) => {
        const bar = resolve(tokens, chart).color;
        for (const accent of ACCENT_COLORS) {
          expect(
            deltaE(bar, ACCENT_SEEDS[accent]),
            `--${chart} vs the ${accent} accent`,
          ).toBeGreaterThanOrEqual(MIN_DELTA_E);
        }
        // The money colours are literals now, so a bar is checked against the
        // three of them once rather than once per accent.
        for (const role of MONEY_ROLES) {
          expect(
            deltaE(bar, resolve(tokens, role).color),
            `--${chart} vs --${role}`,
          ).toBeGreaterThanOrEqual(MIN_DELTA_E);
        }
      },
    );
  });
});
