import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, hueDistance, oklchToHex } from "@/lib/color/oklch";
import { AVATAR_HUES, MONEY_CLEARANCE, avatarHue } from "./avatar-hue";

const CSS = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

/** Every hue a money token is written with, in either theme. */
function moneyHues(): number[] {
  const hues = new Set<number>();
  for (const match of CSS.matchAll(
    /--(?:positive|negative|payer|destructive)(?:-ink)?:\s*oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s*\)/g,
  )) {
    hues.add(Number(match[1]));
  }
  return [...hues];
}

/** The `oklch(L C var(--avatar-hue))` pair a theme's rule paints. */
function pair(selector: string): { bg: [number, number]; fg: [number, number] } {
  const block = new RegExp(
    `${selector.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  ).exec(CSS)?.[1];
  if (!block) throw new Error(`no rule for ${selector}`);
  const read = (property: string): [number, number] => {
    const m = new RegExp(
      `${property}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+var\\(--avatar-hue\\)`,
    ).exec(block);
    if (!m) throw new Error(`${property} missing in ${selector}`);
    return [Number(m[1]), Number(m[2])];
  };
  return { bg: read("background-color"), fg: read("(?<!-)color") };
}

describe("avatar hues", () => {
  it("are a small set, each only once", () => {
    expect(new Set(AVATAR_HUES).size).toBe(AVATAR_HUES.length);
    expect(AVATAR_HUES.length).toBeGreaterThanOrEqual(5);
  });

  it("reads the money hues out of globals.css", () => {
    // Red 25, green 167, amber 70 and 78 — a parse that finds none would make
    // the clearance test below pass for the wrong reason.
    expect(moneyHues()).toEqual(expect.arrayContaining([25, 167, 70, 78]));
  });

  it("keep clear of every money hue", () => {
    for (const hue of AVATAR_HUES) {
      for (const money of moneyHues()) {
        expect(
          hueDistance(hue, money),
          `${hue} is ${hueDistance(hue, money)} degrees from money hue ${money}`,
        ).toBeGreaterThan(MONEY_CLEARANCE);
      }
    }
  });

  it("map the same key to the same hue, whatever its case or padding", () => {
    expect(avatarHue("p-123")).toBe(avatarHue("p-123"));
    expect(avatarHue(" Ravi ")).toBe(avatarHue("ravi"));
    for (const key of ["a", "b", "c", "9f1c-uuid", "Sofia"]) {
      expect(AVATAR_HUES).toContain(avatarHue(key));
    }
  });

  it("use more than one hue across a handful of ids", () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, index) => avatarHue(`participant-${index}`)),
    );
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it.each([
    ["light", "[data-avatar-hue]"],
    ["dark", ".dark [data-avatar-hue]"],
  ])("hold the initial at 4.5:1 on its tint in the %s theme", (_, selector) => {
    const { bg, fg } = pair(selector);
    for (const hue of AVATAR_HUES) {
      const ratio = contrastRatio(
        oklchToHex({ l: bg[0], c: bg[1], h: hue }),
        oklchToHex({ l: fg[0], c: fg[1], h: hue }),
      );
      expect(ratio, `hue ${hue}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
