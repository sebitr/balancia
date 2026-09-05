import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOklch } from "@/lib/color/oklch";
import {
  DEFAULT_SURFACES,
  resolveSurfaces,
  SURFACE_SWATCHES,
  surfaceAttributes,
  themeColorFor,
} from "./surface";

/**
 * The dark surface, and the two promises the module makes about it: the
 * default leaves no trace on the document, and the swatches the settings
 * screen draws are the grounds `globals.css` actually paints.
 *
 * There is no pre-paint script here any more. Increased contrast follows
 * `prefers-contrast: more` from a media query, so there is nothing for a
 * script to decide and nothing for a cookie to disagree with.
 */

// A path rather than a `file:` URL: this file used to run under jsdom, where
// the global URL is the browser's and `readFileSync` will not accept it.
const CSS = readFileSync(
  join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

function cssToken(selector: string, name: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const body = CSS.slice(start, CSS.indexOf("\n}", start));
  const match = body.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`${selector} declares no --${name}`);
  return match[1]!.trim();
}

describe("resolveSurfaces", () => {
  it("falls back to plum for anything it does not know", () => {
    expect(resolveSurfaces({})).toEqual(DEFAULT_SURFACES);
    expect(resolveSurfaces({ dark: 42 })).toEqual(DEFAULT_SURFACES);
    // The cookies two retired settings left behind are simply not read.
    expect(resolveSurfaces({ dark: "paper" })).toEqual(DEFAULT_SURFACES);
  });

  it("keeps what it knows", () => {
    expect(resolveSurfaces({ dark: "midnight" })).toEqual({ dark: "midnight" });
  });
});

describe("surfaceAttributes", () => {
  it("leaves the default off, so an unpainted document is the default one", () => {
    expect(surfaceAttributes(DEFAULT_SURFACES)).toEqual({});
  });

  it("names the choice that is not the default", () => {
    expect(surfaceAttributes({ dark: "midnight" })).toEqual({
      "data-dark": "midnight",
    });
  });
});

describe("the swatches", () => {
  it.each([
    ["cream", ":root"],
    ["plum", ".dark"],
    ["midnight", '.dark[data-dark="midnight"]'],
  ] as const)(
    "draw %s on the ground globals.css paints",
    (surface, selector) => {
      expect(SURFACE_SWATCHES[surface].ground).toEqual(
        parseOklch(cssToken(selector, "background")),
      );
    },
  );

  it("tint the browser chrome with the values the layout used to hard-code", () => {
    // Within a unit per channel: the old literals were rounded by hand, and
    // the conversion lands a hair off them, which no screen can show.
    const channels = (hex: string) =>
      [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const near = (actual: string, expected: string) =>
      channels(actual).every(
        (channel, index) => Math.abs(channel - channels(expected)[index]!) <= 1,
      );
    for (const surface of ["cream", "plum", "midnight"] as const) {
      expect(themeColorFor(surface)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(near(themeColorFor("cream"), "#fbf7f1")).toBe(true);
    expect(near(themeColorFor("plum"), "#2a0e31")).toBe(true);
  });
});
