import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing you can tap is under 44px.
 *
 * Apple's guideline is 44×44pt and Material's is 48×48dp; WCAG 2.2's
 * SC 2.5.8 sets the legal floor at 24×24 CSS px, which is a floor and not a
 * target. This app already believed it in two places — `settings-row.tsx`
 * spends `min-h-11` on every row and says why, and the group tab bar gives
 * each tab 74px — and nowhere else. An audit of a phone at 375px found the
 * search button at 30×30, the theme toggle at 32×32, the notification bell at
 * 36×36, the spending period picker at 105×30, the transaction filter chips at
 * 34px tall, and the home screen's primary action, "Add expense", at 112×34.
 * Every one of those traced to a size written by hand and never checked.
 *
 * Two ways to satisfy this, and a control may take either:
 *
 *  - grow. `Button`'s two text sizes are `h-11` and `h-12` below `md`, and
 *    come back to `h-8`/`h-9` at the desk.
 *  - keep the box and grow the *target*, with `tap-target` from
 *    `globals.css`. This is for the controls that cannot afford the pixels —
 *    the phone header divides 343px between a mark, a group name, a chevron
 *    and three icons, and 44px icons would cost the name twenty of them.
 *    `Button` carries it for every variant, so a `<Button>` is never an
 *    offender however small it is styled.
 *
 * What fails is the third case: a height stated by hand, under 44, on
 * something you can tap, with no expanded target under it.
 *
 * A control that states no height at all is not read. It is sized by its
 * padding and its text and there is no number here to check — the same
 * limitation `text-entry-size.test.ts` accepts, and for the same reason: the
 * bugs this is written against were all literals.
 */

/** Below this, in CSS px, a target needs `tap-target` under it. */
const MINIMUM = 44;

/**
 * Things you can tap, including the Radix triggers that render as one.
 *
 * A trigger with `asChild` renders whatever is inside it — almost always a
 * `Button`, which brings its own target — so `asChild` is treated as a
 * handover and the child is checked on its own line instead.
 */
const INTERACTIVE =
  /<(button|a|Link|[A-Z][A-Za-z]*Trigger|SettingsControlRow|Toggle)\b/g;

/** Marketing is editorial and keeps its own scale — see `AGENTS.md`. */
const UNCOVERED = ["src/components/marketing", "src/app/page.tsx"];

const EXEMPT: { file: string; token: string; why: string }[] = [];

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
 * The px a Tailwind height utility renders at, if it is one.
 *
 * `size-*` sets both axes and so is a height too. Fractions, `full`, `auto`
 * and the viewport units are all sized by something this cannot see, and come
 * back null rather than guessed at.
 */
function heightOf(token: string): number | null {
  const step = /^(?:min-)?(?:h|size)-(\d+(?:\.\d+)?)$/.exec(token);
  if (step) return Number(step[1]) * 4;
  const arbitrary = /^(?:min-)?(?:h|size)-\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(
    token,
  );
  if (!arbitrary) return null;
  const value = Number(arbitrary[1]);
  return arbitrary[2] === "rem" ? value * 16 : value;
}

/**
 * The opening tag of every interactive element in a file.
 *
 * Braces are tracked so a `>` inside an expression — the `=>` of an `onClick`,
 * most often — does not end the tag early. Lifted from
 * `text-entry-size.test.ts`, which learned it the same way.
 */
function openingTags(source: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  let match: RegExpExecArray | null;
  const opens = new RegExp(INTERACTIVE.source, "g");
  while ((match = opens.exec(source))) {
    let depth = 0;
    let index = match.index;
    while (index < source.length) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
      index += 1;
    }
    found.push({
      tag: source.slice(match.index, index),
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

/**
 * The class names reaching a control, following the one indirection the app
 * uses: a module-level `const ROW = "…"` shared by rows that render twice.
 */
function classesFor(tag: string, source: string): string[] {
  const classes: string[] = [];
  const attributes = tag
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
  for (const literal of attributes.matchAll(/"([^"]*)"|`([^`$]*)`/g)) {
    classes.push(...(literal[1] ?? literal[2] ?? "").split(/\s+/));
  }
  for (const identifier of attributes.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    const declaration = new RegExp(
      `const ${identifier[1]}\\s*(?::[^=]+)?=\\s*(?:cn\\()?\\s*("(?:[^"\\\\]|\\\\.)*"|\`[^\`$]*\`)`,
    ).exec(source);
    if (declaration) {
      classes.push(...declaration[1].slice(1, -1).split(/\s+/));
    }
  }
  return classes;
}

describe("tappable controls on a phone", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    for (const { tag, line } of openingTags(source)) {
      // A trigger that hands its rendering to a child is that child's problem.
      if (/\basChild\b/.test(tag)) continue;

      const classes = classesFor(tag, source);
      if (classes.includes("tap-target")) continue;

      // Only unprefixed utilities apply on a phone: `md:` starts at 48rem and
      // `sm:` at 40rem, both wider than any phone this holds for.
      const stated = classes
        .filter((token) => !token.includes(":"))
        .map((token) => ({ token, px: heightOf(token) }))
        .filter((entry): entry is { token: string; px: number } =>
          Boolean(entry.px !== null),
        );

      // A floor and a height together: the tallest wins, which is what the
      // finger gets.
      const tallest = stated.reduce<number | null>(
        (best, entry) => (best === null || entry.px > best ? entry.px : best),
        null,
      );
      if (tallest === null || tallest >= MINIMUM) continue;

      const token = stated.find((entry) => entry.px === tallest)?.token ?? "";
      if (
        EXEMPT.some((entry) => entry.file === file && entry.token === token)
      ) {
        continue;
      }

      offenders.push(
        `${file}:${line} — <${/<(\w+)/.exec(tag)?.[1]}> is ${tallest}px on a phone (${token})`,
      );
    }
  }

  it("are never smaller than 44px, or say tap-target", () => {
    expect(offenders).toEqual([]);
  });
});
