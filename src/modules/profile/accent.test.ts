import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deltaE,
  formatOklch,
  hueDistance,
  isInGamut,
  oklchToHex,
  parseOklch,
  type Oklch,
} from "@/lib/color/oklch";
import {
  ACCENT_COLORS,
  ACCENT_SEEDS,
  accentPalette,
  accentTokens,
  type AccentColor,
} from "./accent";
import {
  AA_TEXT,
  AAA_TEXT,
  inkSurfaces,
  MIN_HUE_SEPARATION,
  MONEY_BASE,
  MONEY_ROLES,
  SURFACES,
  type MoneyRole,
  type Theme,
} from "./money-tones";

/**
 * Seven accents, two themes, and the one promise the palette makes: the
 * money colours are never the accent.
 *
 * `src/app/token-contrast.test.ts` reads `globals.css` and checks the palette
 * as drawn — which is to say, coral. This file checks the other six, and the
 * arithmetic that makes them safe: every ink the accent emits is readable on
 * every surface it lands on, every value is inside sRGB, and every money
 * colour keeps forty degrees and a visible distance from the accent it sits
 * beside.
 *
 * The expected table at the bottom is deliberately spelled out rather than
 * snapshotted. A change to the generator, or to a seed, shows up as a diff in
 * numbers somebody can read, and the table is what the iOS mirror copies.
 */

const THEMES: readonly Theme[] = ["light", "dark"];

/**
 * How far apart two tokens must be to mean different things, in OKLab.
 *
 * About 0.02 is the smallest step an eye separates. Forty degrees of hue at
 * the chroma the fills carry is a chord of 0.089; the inks, walked to the
 * same lightness as each other, come a little closer — the amber accent's ink
 * against its olive payer is 0.080. Today's collisions sit at 0.000 (mint on
 * the "gets back" green in dark) to 0.045 (amber on the payer), so a floor at
 * 0.075 rejects every one of them and accepts every rotation with margin.
 */
const MIN_DELTA_E = 0.075;

const CSS = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

function cssToken(selector: string, name: string): Oklch {
  const start = CSS.indexOf(`${selector} {`);
  const body = CSS.slice(start, CSS.indexOf("\n}", start));
  const match = body.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`${selector} declares no --${name}`);
  // The accent-aware tokens are `var(--accent-…, <fallback>)`; the fallback
  // is the palette as drawn, which is what this file compares against.
  const value = match[1]!.trim();
  const fallback = value.startsWith("var(")
    ? value.slice(value.indexOf(",") + 1, -1).trim()
    : value;
  const parsed = parseOklch(fallback);
  if (!parsed) throw new Error(`--${name} is not a bare oklch(): ${value}`);
  return parsed;
}

const short = (color: Oklch) => formatOklch(color).slice(6, -1);

describe("the surfaces the inks are checked on", () => {
  it.each(THEMES)("match globals.css in the %s theme", (theme) => {
    const selector = theme === "light" ? ":root" : ".dark";
    expect(SURFACES[theme].card).toEqual(cssToken(selector, "card"));
    expect(SURFACES[theme].background).toEqual(
      cssToken(selector, "background"),
    );
  });

  it.each(THEMES)(
    "start from the money fills globals.css draws, %s",
    (theme) => {
      const selector = theme === "light" ? ":root" : ".dark";
      for (const role of MONEY_ROLES) {
        expect(MONEY_BASE[theme][role], role).toEqual(cssToken(selector, role));
      }
    },
  );
});

describe.each(ACCENT_COLORS)("%s", (accent) => {
  const palette = accentPalette(accent);
  const seed = ACCENT_SEEDS[accent];

  it("keeps the seed as the fill, readable under plum", () => {
    expect(palette.fill).toEqual(seed);
    const plum = oklchToHex(cssToken(":root", "primary-foreground"));
    expect(contrastRatio(oklchToHex(seed), plum)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  describe.each(THEMES)("in the %s theme", (theme) => {
    const surfaces = inkSurfaces(seed, theme);

    it("emits an ink that reads on every surface it lands on", () => {
      for (const surface of surfaces) {
        expect(
          contrastRatio(oklchToHex(palette.ink[theme]), surface),
        ).toBeGreaterThanOrEqual(AA_TEXT);
        expect(
          contrastRatio(oklchToHex(palette.inkMore[theme]), surface),
        ).toBeGreaterThanOrEqual(AAA_TEXT);
      }
    });

    it("keeps the ink the accent's own hue", () => {
      expect(palette.ink[theme].h).toBe(seed.h);
      expect(palette.inkMore[theme].h).toBe(seed.h);
    });

    it.each(MONEY_ROLES)("keeps its distance from the %s colour", (role) => {
      const tone = palette.money[theme][role];
      expect(hueDistance(seed.h, tone.fill.h)).toBeGreaterThanOrEqual(
        MIN_HUE_SEPARATION,
      );
      expect(deltaE(seed, tone.fill)).toBeGreaterThanOrEqual(MIN_DELTA_E);
      expect(deltaE(palette.ink[theme], tone.ink)).toBeGreaterThanOrEqual(
        MIN_DELTA_E,
      );
    });

    it.each(MONEY_ROLES)(
      "moves the %s colour only as far as it must",
      (role) => {
        const base = MONEY_BASE[theme][role];
        const tone = palette.money[theme][role];
        // Lightness and chroma are the token's; only the hue rotates, and
        // only when the base sat too close.
        expect(tone.fill.l).toBe(base.l);
        if (hueDistance(base.h, seed.h) >= MIN_HUE_SEPARATION) {
          expect(tone.fill).toEqual(base);
        } else {
          expect(hueDistance(seed.h, tone.fill.h)).toBe(MIN_HUE_SEPARATION);
        }
      },
    );

    it.each(MONEY_ROLES)("emits a readable, in-gamut %s ink", (role) => {
      const tone = palette.money[theme][role];
      for (const surface of inkSurfaces(tone.fill, theme)) {
        expect(
          contrastRatio(oklchToHex(tone.ink), surface),
        ).toBeGreaterThanOrEqual(AA_TEXT);
        expect(
          contrastRatio(oklchToHex(tone.inkMore), surface),
        ).toBeGreaterThanOrEqual(AAA_TEXT);
      }
      for (const color of [tone.fill, tone.ink, tone.inkMore]) {
        expect(isInGamut(color), short(color)).toBe(true);
      }
    });
  });

  it("emits every variable, in both themes, every time", () => {
    const tokens = accentTokens(accent);
    const expected = [
      "--primary",
      "--ring",
      "--sidebar-primary",
      "--sidebar-ring",
      ...THEMES.flatMap((theme) => [
        `--accent-ink-${theme}`,
        `--accent-ink-more-${theme}`,
        ...MONEY_ROLES.flatMap((role) => [
          `--accent-${role}-${theme}`,
          `--accent-${role}-ink-${theme}`,
          `--accent-${role}-ink-more-${theme}`,
        ]),
      ]),
    ];
    expect(Object.keys(tokens).sort()).toEqual(expected.sort());
    expect(tokens["--primary"]).toBe(formatOklch(seed));
    for (const value of Object.values(tokens)) {
      const parsed = parseOklch(value);
      expect(parsed, value).not.toBeNull();
      expect(isInGamut(parsed!), value).toBe(true);
    }
  });
});

/**
 * What the arithmetic comes to, spelled out.
 *
 * Fill and ink for the accent and each money role, per theme, as "L C H".
 * Three accents move a money colour: coral sends "you owe" to ruby, mint
 * sends "gets back" to grass, amber nudges "you owe" and sends the payer to
 * olive. The other four leave all three where `globals.css` drew them.
 */
type Row = { readonly fill: string; readonly ink: string };
type Expected = Record<
  Theme,
  { readonly accent: Row } & Record<MoneyRole, Row>
>;

const NEGATIVE = {
  light: { fill: "0.639 0.18 32", ink: "0.534 0.18 32" },
  dark: { fill: "0.72 0.16 32", ink: "0.73 0.16 32" },
};
const POSITIVE = {
  light: { fill: "0.654 0.13 167", ink: "0.509 0.104 167" },
  dark: { fill: "0.75 0.13 167", ink: "0.75 0.13 167" },
};
const PAYER = {
  light: { fill: "0.72 0.145 70", ink: "0.535 0.115 70" },
  dark: { fill: "0.82 0.14 78", ink: "0.82 0.14 78" },
};

const EXPECTED: Record<AccentColor, Expected> = {
  coral: {
    light: {
      accent: { fill: "0.712 0.168 30", ink: "0.542 0.168 30" },
      negative: { fill: "0.639 0.18 350", ink: "0.539 0.18 350" },
      positive: POSITIVE.light,
      payer: PAYER.light,
    },
    dark: {
      accent: { fill: "0.712 0.168 30", ink: "0.732 0.164 30" },
      negative: { fill: "0.72 0.16 350", ink: "0.74 0.16 350" },
      positive: POSITIVE.dark,
      payer: PAYER.dark,
    },
  },
  amber: {
    light: {
      accent: { fill: "0.78 0.13 70", ink: "0.54 0.116 70" },
      negative: { fill: "0.639 0.18 30", ink: "0.534 0.18 30" },
      positive: POSITIVE.light,
      payer: { fill: "0.72 0.145 110", ink: "0.525 0.115 110" },
    },
    dark: {
      accent: { fill: "0.78 0.13 70", ink: "0.78 0.13 70" },
      negative: { fill: "0.72 0.16 30", ink: "0.735 0.16 30" },
      positive: POSITIVE.dark,
      payer: { fill: "0.82 0.14 110", ink: "0.82 0.14 110" },
    },
  },
  mint: {
    light: {
      accent: { fill: "0.75 0.13 167", ink: "0.52 0.106 167" },
      negative: NEGATIVE.light,
      positive: { fill: "0.654 0.13 127", ink: "0.514 0.13 127" },
      payer: PAYER.light,
    },
    dark: {
      accent: { fill: "0.75 0.13 167", ink: "0.75 0.13 167" },
      negative: NEGATIVE.dark,
      positive: { fill: "0.75 0.13 127", ink: "0.75 0.13 127" },
      payer: PAYER.dark,
    },
  },
  ocean: {
    light: {
      accent: { fill: "0.71 0.12 235", ink: "0.525 0.11 235" },
      negative: NEGATIVE.light,
      positive: POSITIVE.light,
      payer: PAYER.light,
    },
    dark: {
      accent: { fill: "0.71 0.12 235", ink: "0.71 0.12 235" },
      negative: NEGATIVE.dark,
      positive: POSITIVE.dark,
      payer: PAYER.dark,
    },
  },
  lavender: {
    light: {
      accent: { fill: "0.72 0.13 300", ink: "0.54 0.13 300" },
      negative: NEGATIVE.light,
      positive: POSITIVE.light,
      payer: PAYER.light,
    },
    dark: {
      accent: { fill: "0.72 0.13 300", ink: "0.73 0.13 300" },
      negative: NEGATIVE.dark,
      positive: POSITIVE.dark,
      payer: PAYER.dark,
    },
  },
  raspberry: {
    light: {
      accent: { fill: "0.7 0.17 350", ink: "0.545 0.17 350" },
      negative: NEGATIVE.light,
      positive: POSITIVE.light,
      payer: PAYER.light,
    },
    dark: {
      accent: { fill: "0.7 0.17 350", ink: "0.735 0.17 350" },
      negative: NEGATIVE.dark,
      positive: POSITIVE.dark,
      payer: PAYER.dark,
    },
  },
  plum: {
    light: {
      accent: { fill: "0.71 0.048 319", ink: "0.535 0.048 319" },
      negative: NEGATIVE.light,
      positive: POSITIVE.light,
      payer: PAYER.light,
    },
    dark: {
      accent: { fill: "0.71 0.048 319", ink: "0.725 0.048 319" },
      negative: NEGATIVE.dark,
      positive: POSITIVE.dark,
      payer: PAYER.dark,
    },
  },
};

describe("the palette, spelled out", () => {
  it.each(ACCENT_COLORS)("%s comes to the expected table", (accent) => {
    const palette = accentPalette(accent);
    const actual: Expected = {
      light: {
        accent: { fill: short(palette.fill), ink: short(palette.ink.light) },
        negative: rowOf(palette.money.light.negative),
        positive: rowOf(palette.money.light.positive),
        payer: rowOf(palette.money.light.payer),
      },
      dark: {
        accent: { fill: short(palette.fill), ink: short(palette.ink.dark) },
        negative: rowOf(palette.money.dark.negative),
        positive: rowOf(palette.money.dark.positive),
        payer: rowOf(palette.money.dark.payer),
      },
    };
    expect(actual).toEqual(EXPECTED[accent]);
  });
});

function rowOf(tone: { fill: Oklch; ink: Oklch }): Row {
  return { fill: short(tone.fill), ink: short(tone.ink) };
}
