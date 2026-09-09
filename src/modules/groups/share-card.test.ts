import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  blend,
  parseOklch,
  type Oklch,
} from "@/lib/color/oklch";
import { palette } from "@/modules/auth/emails/tokens";
import { GROUP_ICONS, GROUP_ICON_COLORS } from "./icons";
import {
  isShareCardIcon,
  NO_SHARE_CARD_ICON,
  shareCardAccent,
  shareCardPath,
  SHARE_CARD_ACCENTS,
} from "./share-card";

/**
 * The share card's accents against the theme they claim to come from.
 *
 * Satori resolves no custom property, so these five have to be literals — the
 * same bind the email palette is in, and the same answer: re-derive them from
 * `globals.css` on every run, so retuning a token fails here naming the
 * constant that stopped following it rather than leaving one accent quietly
 * wrong in a chat bubble.
 *
 * The card is drawn on the dark ground, so it is the dark theme's values that
 * apply. The light ones exist for an icon on cream and are nothing to do with
 * this.
 */

const DARK_THEME = /\n\.dark\s*\{([\s\S]*?)\n\}/.exec(
  readFileSync("src/app/globals.css", "utf8"),
)?.[1];

function token(name: string): Oklch {
  const declaration = new RegExp(`--${name}:\\s*([^;]+);`).exec(
    DARK_THEME ?? "",
  )?.[1];
  if (!declaration) throw new Error(`--${name} is not declared in .dark`);
  const parsed = parseOklch(declaration);
  if (!parsed) throw new Error(`--${name} is not an oklch() value`);
  return parsed;
}

/** WCAG 2.2 1.4.11 — an icon stroke is a graphical object. */
const AA_GRAPHIC = 3;

describe("the share card's accents", () => {
  it("finds the dark theme to derive from", () => {
    expect(DARK_THEME).toBeTruthy();
  });

  it.each(GROUP_ICON_COLORS)("follows --group-accent-%s", (color) => {
    expect(SHARE_CARD_ACCENTS[color]).toEqual(token(`group-accent-${color}`));
  });

  it.each(GROUP_ICON_COLORS)(
    "draws %s legibly on the card's own tint",
    (color) => {
      // What the card actually puts on screen: the accent as a stroke, over
      // itself at 20% over the ground. The tile is the reason this is not the
      // same question `token-contrast.test.ts` asks about a dark surface.
      const accent = shareCardAccent(color);
      const tint = blend(accent, 0.2, palette.ink);
      expect(contrastRatio(accent, tint)).toBeGreaterThanOrEqual(AA_GRAPHIC);
    },
  );
});

describe("where a group's card is served from", () => {
  it("names the icon and the accent, and nothing about the group", () => {
    expect(shareCardPath("plane", "blue")).toBe("/join/og/blue/plane");
  });

  it("falls back to the accent a group gets when it chooses none", () => {
    expect(shareCardPath(null, null)).toBe(
      `/join/og/coral/${NO_SHARE_CARD_ICON}`,
    );
  });

  it("keeps the accent a group did choose when it has no icon", () => {
    expect(shareCardPath(null, "amber")).toBe(
      `/join/og/amber/${NO_SHARE_CARD_ICON}`,
    );
  });

  it.each(GROUP_ICONS)("accepts %s as a card", (icon) => {
    expect(isShareCardIcon(icon)).toBe(true);
  });

  it("accepts the no-icon card and refuses anything else", () => {
    expect(isShareCardIcon(NO_SHARE_CARD_ICON)).toBe(true);
    expect(isShareCardIcon("rocket")).toBe(false);
    expect(isShareCardIcon("../../etc/passwd")).toBe(false);
    expect(isShareCardIcon(undefined)).toBe(false);
  });
});
