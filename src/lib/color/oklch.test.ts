import { describe, expect, it } from "vitest";
import {
  blend,
  contrastRatio,
  darkenUntilReadable,
  oklchToHex,
  parseOklch,
  relativeLuminance,
} from "./oklch";

describe("parsing", () => {
  it("reads a token with or without the function wrapper", () => {
    expect(parseOklch("oklch(0.712 0.168 30)")).toEqual({
      l: 0.712,
      c: 0.168,
      h: 30,
    });
    expect(parseOklch("0.712 0.168 30")).toEqual({ l: 0.712, c: 0.168, h: 30 });
  });

  it("refuses anything else, rather than guessing", () => {
    // Some tokens are `oklch(1 0 0 / 12%)` or a plain hex; a caller needs to
    // find that out here and not two conversions later.
    expect(parseOklch("oklch(1 0 0 / 12%)")).toBeNull();
    expect(parseOklch("#f97361")).toBeNull();
    expect(parseOklch("")).toBeNull();
  });
});

describe("conversion", () => {
  it("maps the achromatic ends exactly", () => {
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe("#FFFFFF");
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe("#000000");
  });

  it("converts the theme's primary", () => {
    expect(oklchToHex({ l: 0.712, c: 0.168, h: 30 })).toBe("#F97360");
  });

  it("clips out-of-gamut chroma rather than wrapping it", () => {
    // Far outside sRGB. Every channel must still land in range.
    const hex = oklchToHex({ l: 0.5, c: 0.9, h: 140 });
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe("contrast", () => {
  it("agrees with the WCAG reference points", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("does not care which way round the pair is given", () => {
    expect(contrastRatio("#2A0E31", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FFFFFF", "#2A0E31"),
      10,
    );
  });
});

describe("blending", () => {
  it("composites at an alpha over an opaque backdrop", () => {
    expect(blend("#000000", 0.5, "#FFFFFF")).toBe("#808080");
    expect(blend("#123456", 1, "#FFFFFF")).toBe("#123456");
    expect(blend("#123456", 0, "#FFFFFF")).toBe("#FFFFFF");
  });
});

describe("darkening for readability", () => {
  it("stops as soon as the ratio is met", () => {
    const coral = { l: 0.712, c: 0.168, h: 30 };
    const darkened = darkenUntilReadable(coral, "#FFFFFF", 4.5);
    expect(
      contrastRatio(oklchToHex(darkened), "#FFFFFF"),
    ).toBeGreaterThanOrEqual(4.5);
    expect(darkened.l).toBeLessThan(coral.l);
  });

  it("leaves a colour that already passes alone", () => {
    const plum = { l: 0.226, c: 0.072, h: 319 };
    expect(darkenUntilReadable(plum, "#FFFFFF", 4.5)).toEqual(plum);
  });

  it("keeps the hue and chroma it started with", () => {
    const coral = { l: 0.712, c: 0.168, h: 30 };
    const darkened = darkenUntilReadable(coral, "#FFFFFF", 4.5);
    expect(darkened.c).toBe(coral.c);
    expect(darkened.h).toBe(coral.h);
  });

  it("terminates on a target no colour can reach", () => {
    // 21:1 against black is impossible for anything but white; the loop must
    // bottom out at black rather than spin.
    const darkened = darkenUntilReadable(
      { l: 0.712, c: 0.168, h: 30 },
      "#000000",
      21,
    );
    expect(darkened.l).toBeLessThanOrEqual(0);
  });
});
