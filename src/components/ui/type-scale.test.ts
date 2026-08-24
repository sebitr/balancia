import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Seven type sizes, and a phone gets a point more than a desk.
 *
 * `globals.css` redefines every `--text-*` token below `md`, which is what
 * lifts the whole app a point in the hand — the viewport nearly all of it is
 * read at. A utility rides that lever. A literal `text-[13px]` does not: it
 * renders thirteen pixels at every width, so the moment the phone scale moved,
 * the literals stayed behind.
 *
 * The entry detail screens are how that goes wrong in practice. They came from
 * a handoff drawn at 390pt and were written as literals to match it, so the
 * uppercase label above each field of the meta strip rendered at 10px on a
 * phone — two points under `text-2xs`, which is the floor the rest of the app
 * cannot go below — while the row titles beside them sat a point under the
 * `text-sm` the same rows use everywhere else.
 *
 * `design-system/src/pages/foundations/typography.html` already said an
 * arbitrary size in product code is a bug. Saying it was not enough, so it is
 * checked here instead.
 *
 * Two things are allowed through, and nothing else:
 *
 *  - a size at or above the top of the scale. The balance heroes' display
 *    numerals are the scale's one documented exception, and they are all far
 *    larger than `text-2xl`; nothing up there is at risk of being too small to
 *    read, which is the whole point of the floor.
 *  - the handful of glyphs listed in `EXEMPT` below, sized as pictures rather
 *    than as type.
 *
 * The marketing pages are not covered — an editorial surface with its own
 * scale, per `AGENTS.md`.
 */

/** The desk-scale px of the top step. A phone renders it at 25. */
const TOP_OF_SCALE = 24;

/**
 * Characters sized as pictures, not as type. Each is an icon that happens to
 * be a glyph: hidden from the accessibility tree, carrying no words, and sized
 * to its box rather than to a step.
 */
const EXEMPT: { file: string; token: string; why: string }[] = [
  {
    file: "src/components/money/currency-picker.tsx",
    token: "text-[22px]",
    why: "the flag emoji in a currency row — an icon, aria-hidden, sized to its 26px box",
  },
];

/** Marketing is editorial and keeps its own scale. */
const UNCOVERED = ["src/components/marketing", "src/app/page.tsx"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith(".tsx")) return [];
    if (entry.name.includes(".test.")) return [];
    if (UNCOVERED.some((prefix) => path.startsWith(prefix))) return [];
    return [path];
  });
}

/**
 * Arbitrary font sizes in a file, as `text-[…]` holding a length.
 *
 * `text-[--brand]` and `text-[#fff]` are colours wearing the same prefix and
 * do not match; only a number with a unit does. Comments are stripped first,
 * or the prose explaining why a size is what it is gets read as a use of it.
 */
function arbitrarySizes(
  source: string,
): { token: string; px: number; line: number }[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
  const found: { token: string; px: number; line: number }[] = [];
  const sizes = /\btext-\[(\d+(?:\.\d+)?)(px|rem)\]/g;
  let match: RegExpExecArray | null;
  while ((match = sizes.exec(stripped))) {
    const value = Number(match[1]);
    found.push({
      token: match[0],
      px: match[2] === "rem" ? value * 16 : value,
      line: stripped.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

describe("the type scale", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    for (const { token, px, line } of arbitrarySizes(source)) {
      if (px >= TOP_OF_SCALE) continue;
      if (EXEMPT.some((one) => one.file === file && one.token === token)) {
        continue;
      }
      offenders.push(
        `${file}:${line} — ${token} sits below the scale's top step, so it belongs on a step: ` +
          `text-2xs, text-xs, text-sm, text-base, text-lg, text-xl or text-2xl`,
      );
    }
  }

  it("holds every product size that is not a display numeral", () => {
    expect(offenders).toEqual([]);
  });
});
