import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blend,
  contrastRatio,
  darkenUntilReadable,
  oklchToHex,
  parseOklch,
  type Oklch,
} from "@/lib/color/oklch";
import { palette } from "./tokens";

/**
 * The email palette against the theme it claims to come from.
 *
 * `tokens.ts` has to hold literal hex — email clients read neither `oklch()`
 * nor custom properties — which normally means a second copy of the palette
 * quietly drifting from the first. This is what stops that: every value is
 * re-derived from `src/app/globals.css` here, so moving a token turns into a
 * failure naming the constant that no longer follows from it, rather than into
 * an email that is slightly the wrong colour for a year.
 *
 * The contrast assertions are the other half. Three values exist only because
 * their token fails as text at body size, and a rule like "darkened until it
 * passes" is worth nothing unless something checks that it still does.
 */

const LIGHT_THEME = /:root\s*\{([\s\S]*?)\n\}/.exec(
  readFileSync("src/app/globals.css", "utf8"),
)?.[1];

/** The light theme's value for one custom property, as OKLCH. */
function token(name: string): Oklch {
  const declaration = new RegExp(`--${name}:\\s*([^;]+);`).exec(
    LIGHT_THEME ?? "",
  )?.[1];
  if (!declaration) throw new Error(`--${name} is not declared in :root`);
  const parsed = parseOklch(declaration);
  if (!parsed) throw new Error(`--${name} is not an oklch() value`);
  return parsed;
}

const hex = (name: string): string => oklchToHex(token(name));

/** WCAG 2.2 AA for body-size text; AAA is 7. */
const AA = 4.5;

describe("the email palette", () => {
  it("finds the light theme to derive from", () => {
    expect(LIGHT_THEME).toBeTruthy();
  });

  it.each([
    ["ground", "border"],
    ["wrapper", "background"],
    ["surface", "card"],
    ["ink", "foreground"],
    ["mutedInk", "muted-foreground"],
    ["primary", "primary"],
    ["primaryInk", "primary-foreground"],
    ["destructive", "destructive"],
  ])("%s is --%s converted", (role, name) => {
    expect(palette[role as keyof typeof palette]).toBe(hex(name));
  });

  it("derives the link colour from --primary, darkened for AA", () => {
    // Against the cream panel rather than the white cell: for dark ink the
    // darker of the two surfaces is the harder one, and the fallback URL sits
    // on it.
    expect(palette.link).toBe(
      oklchToHex(darkenUntilReadable(token("primary"), palette.wrapper, AA)),
    );
  });

  it("derives the warning tint from --destructive at 8%", () => {
    expect(palette.destructiveTint).toBe(
      blend(hex("destructive"), 0.08, palette.surface),
    );
  });

  it("derives the warning body colour, darkened to AAA on that tint", () => {
    expect(palette.destructiveInk).toBe(
      oklchToHex(
        darkenUntilReadable(token("destructive"), palette.destructiveTint, 7),
      ),
    );
  });
});

describe("every pairing the emails actually use", () => {
  it.each([
    ["body copy on a cell", palette.ink, palette.surface],
    ["secondary copy on a cell", palette.mutedInk, palette.surface],
    ["the fallback label on its panel", palette.mutedInk, palette.wrapper],
    ["a link on a cell", palette.link, palette.surface],
    ["the fallback URL on its panel", palette.link, palette.wrapper],
    ["the button label on its fill", palette.primaryInk, palette.primary],
    ["the wordmark on the header bar", palette.wrapper, palette.ink],
    [
      "the warning title on its tint",
      palette.destructive,
      palette.destructiveTint,
    ],
    [
      "the warning body on its tint",
      palette.destructiveInk,
      palette.destructiveTint,
    ],
  ])("meets AA: %s", (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA);
  });

  it("keeps raw --primary out of text roles", () => {
    // Coral is a fill. As 14px copy on white it is under 3:1, which is the
    // reason `link` exists at all — this fails if someone "simplifies" them
    // back into one value.
    expect(contrastRatio(palette.primary, palette.surface)).toBeLessThan(AA);
    expect(palette.link).not.toBe(palette.primary);
  });

  it("keeps the warning title and body distinct", () => {
    // The panel's hierarchy is a title in the token and body copy below it.
    // Collapsing them loses the distinction the design draws.
    expect(palette.destructiveInk).not.toBe(palette.destructive);
  });
});
