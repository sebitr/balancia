import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  formatOklch,
  isInGamut,
  oklchToHex,
  parseOklch,
  type Oklch,
} from "@/lib/color/oklch";
import {
  AA_TEXT,
  AAA_TEXT,
  ACCENT_COLORS,
  ACCENT_SEEDS,
  accentPalette,
  accentTokens,
  inkSurfaces,
  MONEY_ROLES,
  SURFACES,
  type AccentColor,
  type Theme,
} from "./accent";

/**
 * Seven accents, two themes, and the one promise the palette still makes.
 *
 * It used to be "the money colours are never the accent", kept by rotating
 * any money hue that came within forty degrees of the accent. That is gone,
 * and this file is where the reason is written down, because it will look
 * like an oversight to whoever reads it next.
 *
 * The rotation could not be made to look like anything. In the dark theme
 * the accent seeds sit at L 0.70–0.78 and the money fills at L 0.72–0.82, and
 * an ink is walked in lightness until it clears 4.5:1 — so two inks of
 * similar chroma converge on the same lightness whatever hue they began at.
 * Lightness and chroma are spoken for; hue is the only axis left; and hue
 * needs roughly thirty degrees before the eye separates two fills at this
 * chroma. Thirty degrees is also exactly far enough to stop a red being red.
 * Searching the whole feasible red band turns up nothing better: the closest
 * a "you owe" comes to being both distinct from coral and still red is a
 * pink, which is what the rule actually shipped.
 *
 * So the money colours are literals in `globals.css` now, the same on every
 * account, and the accent is allowed to be their neighbour. What keeps a
 * balance legible is not its hue: it is the sign and the word beside it
 * (`src/components/money/balance-tone.ts`) and the rule that the accent never
 * paints a money surface (`AGENTS.md`). The first assertion below is the one
 * that stops the rotation coming back.
 */

const THEMES: readonly Theme[] = ["light", "dark"];

const CSS = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

/** One declaration's raw value, exactly as the stylesheet writes it. */
function rawToken(selector: string, name: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const body = CSS.slice(start, CSS.indexOf("\n}", start));
  const match = body.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`${selector} declares no --${name}`);
  return match[1]!.trim();
}

function cssToken(selector: string, name: string): Oklch {
  const value = rawToken(selector, name);
  const parsed = parseOklch(value);
  if (!parsed) throw new Error(`--${name} is not a bare oklch(): ${value}`);
  return parsed;
}

const selectorFor = (theme: Theme) => (theme === "light" ? ":root" : ".dark");
const short = (color: Oklch) => formatOklch(color).slice(6, -1);

describe("the money colours", () => {
  it.each(THEMES)(
    "are literals in the %s theme, not derived from the accent",
    (theme) => {
      for (const role of MONEY_ROLES) {
        for (const name of [role, `${role}-ink`]) {
          expect(
            rawToken(selectorFor(theme), name),
            `--${name} must not be built from the accent`,
          ).not.toContain("var(");
        }
      }
    },
  );

  it("are never painted onto the document by an accent", () => {
    const painted = ACCENT_COLORS.flatMap((accent) =>
      Object.keys(accentTokens(accent)),
    ).join(" ");
    for (const role of MONEY_ROLES) {
      expect(painted, `${role} is painted per account`).not.toContain(role);
    }
  });
});

describe("the surfaces the inks are checked on", () => {
  it.each(THEMES)("match globals.css in the %s theme", (theme) => {
    const selector = selectorFor(theme);
    expect(SURFACES[theme].card).toEqual(cssToken(selector, "card"));
    expect(SURFACES[theme].background).toEqual(
      cssToken(selector, "background"),
    );
  });
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

    it("only walks the ink when the seed itself will not do", () => {
      // The seed is where the walk starts, so an ink that moved is only
      // honest if the seed failed. This is the minimality the old "moves the
      // colour only as far as it must" test pinned, kept where it still
      // applies — stated against the walk's own starting point rather than
      // against a reconstructed step, because chroma is refitted at every
      // step and a step cannot be rebuilt from the value that came out.
      for (const [ink, ratio] of [
        [palette.ink[theme], AA_TEXT],
        [palette.inkMore[theme], AAA_TEXT],
      ] as const) {
        if (ink.l === seed.l) continue; // readable as drawn; nothing walked
        expect(
          surfaces.some(
            (surface) => contrastRatio(oklchToHex(seed), surface) < ratio,
          ),
          `${short(ink)} walked away from a seed that already read at ${ratio}:1`,
        ).toBe(true);
      }
    });

    it("emits an in-gamut ink", () => {
      for (const color of [palette.ink[theme], palette.inkMore[theme]]) {
        expect(isInGamut(color), short(color)).toBe(true);
      }
    });
  });

  it("emits six variables, and only six", () => {
    const tokens = accentTokens(accent);
    const expected = [
      "--primary",
      "--ring",
      ...THEMES.flatMap((theme) => [
        `--accent-ink-${theme}`,
        `--accent-ink-more-${theme}`,
      ]),
    ];
    expect(Object.keys(tokens).sort()).toEqual(expected.sort());
    expect(tokens["--primary"]).toBe(formatOklch(seed));
    expect(tokens["--ring"]).toBe(formatOklch(seed));
    for (const value of Object.values(tokens)) {
      const parsed = parseOklch(value);
      expect(parsed, value).not.toBeNull();
      expect(isInGamut(parsed!), value).toBe(true);
    }
  });
});

/**
 * The inks, spelled out.
 *
 * The one table left, and the one place transcription earns its keep: these
 * twenty-eight values are what the iOS app copies, and a change to a seed or
 * to the walk shows up here as a diff somebody can read. Everything else in
 * this file is derived. The fills are not listed — they are `ACCENT_SEEDS`,
 * a few lines away in the module under test.
 */
type Inks = Record<Theme, { readonly ink: string; readonly inkMore: string }>;

const EXPECTED: Record<AccentColor, Inks> = {
  coral: {
    light: { ink: "0.542 0.168 30", inkMore: "0.442 0.168 30" },
    dark: { ink: "0.732 0.164 30", inkMore: "0.847 0.084 30" },
  },
  amber: {
    light: { ink: "0.54 0.116 70", inkMore: "0.44 0.096 70" },
    dark: { ink: "0.78 0.13 70", inkMore: "0.865 0.104 70" },
  },
  mint: {
    light: { ink: "0.52 0.106 167", inkMore: "0.42 0.086 167" },
    dark: { ink: "0.75 0.13 167", inkMore: "0.83 0.13 167" },
  },
  ocean: {
    light: { ink: "0.525 0.11 235", inkMore: "0.42 0.088 235" },
    dark: { ink: "0.71 0.12 235", inkMore: "0.83 0.098 235" },
  },
  lavender: {
    light: { ink: "0.54 0.13 300", inkMore: "0.44 0.13 300" },
    dark: { ink: "0.73 0.13 300", inkMore: "0.85 0.086 300" },
  },
  raspberry: {
    light: { ink: "0.545 0.17 350", inkMore: "0.445 0.17 350" },
    dark: { ink: "0.735 0.17 350", inkMore: "0.855 0.092 350" },
  },
  plum: {
    light: { ink: "0.535 0.048 319", inkMore: "0.43 0.048 319" },
    dark: { ink: "0.725 0.048 319", inkMore: "0.85 0.048 319" },
  },
};

describe("the inks, spelled out", () => {
  it.each(ACCENT_COLORS)("%s comes to the expected table", (accent) => {
    const palette = accentPalette(accent);
    const actual: Inks = {
      light: {
        ink: short(palette.ink.light),
        inkMore: short(palette.inkMore.light),
      },
      dark: {
        ink: short(palette.ink.dark),
        inkMore: short(palette.inkMore.dark),
      },
    };
    expect(actual).toEqual(EXPECTED[accent]);
  });
});
