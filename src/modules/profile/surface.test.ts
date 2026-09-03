// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOklch } from "@/lib/color/oklch";
import {
  CONTRAST_PREPAINT_SCRIPT,
  DEFAULT_SURFACES,
  resolveSurfaces,
  SURFACE_SWATCHES,
  surfaceAttributes,
  themeColorFor,
} from "./surface";

/**
 * The surfaces, and the two promises the module makes about them: the
 * defaults leave no trace on the document, and the swatches the settings
 * screen draws are the grounds `globals.css` actually paints.
 */

// A path rather than a `file:` URL: under jsdom the global URL is the
// browser's, which `readFileSync` does not accept.
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
  it("falls back to cream, plum and auto for anything it does not know", () => {
    expect(resolveSurfaces({})).toEqual(DEFAULT_SURFACES);
    expect(
      resolveSurfaces({ light: "neon", dark: 42, contrast: "loud" }),
    ).toEqual(DEFAULT_SURFACES);
  });

  it("keeps what it knows", () => {
    expect(
      resolveSurfaces({ light: "paper", dark: "midnight", contrast: "more" }),
    ).toEqual({ light: "paper", dark: "midnight", contrast: "more" });
  });
});

describe("surfaceAttributes", () => {
  it("leaves the defaults off, so an unpainted document is the default one", () => {
    expect(surfaceAttributes(DEFAULT_SURFACES)).toEqual({});
  });

  it("names every choice that is not the default, standard contrast included", () => {
    expect(
      surfaceAttributes({ light: "paper", dark: "midnight", contrast: "more" }),
    ).toEqual({
      "data-light": "paper",
      "data-dark": "midnight",
      "data-contrast": "more",
    });
    // "Standard" changes no token, but it has to be on the element so the
    // pre-paint script does not apply the system's preference over it.
    expect(
      surfaceAttributes({ ...DEFAULT_SURFACES, contrast: "standard" }),
    ).toEqual({ "data-contrast": "standard" });
  });
});

describe("the swatches", () => {
  it.each([
    ["cream", ":root"],
    ["paper", ':root:not(.dark)[data-light="paper"]'],
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
    for (const surface of ["cream", "paper", "plum", "midnight"] as const) {
      expect(themeColorFor(surface)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(near(themeColorFor("cream"), "#fbf7f1")).toBe(true);
    expect(near(themeColorFor("plum"), "#2a0e31")).toBe(true);
  });
});

describe("the pre-paint script", () => {
  const root = document.documentElement;

  afterEach(() => {
    root.removeAttribute("data-contrast");
    vi.unstubAllGlobals();
  });

  const run = (prefersMore: boolean) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: prefersMore })),
    );
    new Function(CONTRAST_PREPAINT_SCRIPT)();
  };

  it("applies the system's preference when nothing was chosen", () => {
    run(true);
    expect(root.getAttribute("data-contrast")).toBe("more");
  });

  it("does nothing when the system has no preference", () => {
    run(false);
    expect(root.hasAttribute("data-contrast")).toBe(false);
  });

  it("leaves a choice alone", () => {
    root.setAttribute("data-contrast", "standard");
    run(true);
    expect(root.getAttribute("data-contrast")).toBe("standard");
  });
});
