import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Safari on iOS zooms the page in whenever a control it can put a caret or a
 * picker in takes focus below 16px, and it never zooms back out — the reader
 * is left on a scaled-up layout to pinch out of by hand, once per field they
 * tap. `docs/development.md` has the long form under _Notes on the stack_.
 *
 * Prose has not been enough on its own: the rule reached this file after the
 * invisible `<input type="date">` on the entry form was found inheriting
 * `text-sm` from the sheet around it, having never stated a size at all. So
 * the rule is checked instead of described.
 *
 * Two things keep a control clear of the floor, and the check accepts either:
 *
 *  - it states a size of its own that is at least 16px below `md`, which is
 *    what `text-base md:text-sm` is for; or
 *  - it states no size at all, and inherits one. `globals.css` puts a
 *    `max(1rem, 1em)` floor under every such control below `md`, so inheriting
 *    is safe — and `text-[44px]` on the amount field still wins, because a
 *    utility outranks that base rule.
 *
 * What fails is the third case: a size stated explicitly, and too small.
 */

/**
 * Below `md` the scale is one point larger — see the `width < 48rem` block in
 * `globals.css`. These are the sizes a phone actually renders, which is the
 * only viewport this rule is about.
 */
const PHONE_PX: Record<string, number> = {
  "text-2xs": 12,
  "text-xs": 13,
  "text-sm": 15,
  "text-base": 17,
  "text-lg": 19,
  "text-xl": 21,
  "text-2xl": 25,
};

/** Controls the browser will not zoom for: it cannot type into them. */
const EXEMPT_TYPES = new Set([
  "hidden",
  "checkbox",
  "radio",
  "file",
  "range",
  "color",
  "submit",
  "button",
  "reset",
  "image",
]);

const MINIMUM = 16;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith(".tsx")) return [];
    if (entry.name.includes(".test.")) return [];
    return [path];
  });
}

/** The px a Tailwind font-size utility renders at on a phone, if it is one. */
function sizeOf(token: string): number | null {
  if (token in PHONE_PX) return PHONE_PX[token];
  const arbitrary = /^text-\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(token);
  if (!arbitrary) return null;
  const value = Number(arbitrary[1]);
  return arbitrary[2] === "rem" ? value * 16 : value;
}

/**
 * The opening tag of every `<input>`, `<textarea>` and `<select>` in a file.
 *
 * Braces are tracked so that a `>` inside an expression — a `=>` in an
 * `onChange`, most often — does not end the tag early.
 */
function openingTags(source: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  const opens = /<(input|textarea|select)\b/g;
  let match: RegExpExecArray | null;
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
 * Class names that reach a control, following the one indirection the app
 * actually uses: a module-level `const FIELD = "…"` shared by the rows that
 * render the same field twice.
 */
function classesFor(tag: string, source: string): string[] {
  const classes: string[] = [];
  // Comments first, or the prose explaining why a field is sized the way it is
  // gets read as the sizing itself — which is how this function's first draft
  // reported the one field it had just been written to vindicate.
  const attributes = tag
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
  for (const literal of attributes.matchAll(/"([^"]*)"|`([^`$]*)`/g)) {
    classes.push(...(literal[1] ?? literal[2] ?? "").split(/\s+/));
  }
  for (const identifier of attributes.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    const declaration = new RegExp(
      `const ${identifier[1]}\\s*(?::[^=]+)?=\\s*("(?:[^"\\\\]|\\\\.)*"|\`[^\`$]*\`)`,
    ).exec(source);
    if (declaration) {
      classes.push(...declaration[1].slice(1, -1).split(/\s+/));
    }
  }
  return classes;
}

describe("text entry controls on a phone", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    for (const { tag, line } of openingTags(source)) {
      const type = /type=(?:"([a-z-]+)"|\{"([a-z-]+)"\})/.exec(tag);
      if (type && EXEMPT_TYPES.has(type[1] ?? type[2] ?? "")) continue;

      // Only unprefixed utilities apply on a phone. `md:` starts at 48rem and
      // `sm:` at 40rem, both wider than any phone this needs to hold for.
      const stated = classesFor(tag, source)
        .filter((token) => !token.includes(":"))
        .map((token) => ({ token, px: sizeOf(token) }))
        .filter((entry): entry is { token: string; px: number } =>
          Boolean(entry.token.startsWith("text-") && entry.px !== null),
        );

      for (const { token, px } of stated) {
        if (px < MINIMUM) {
          offenders.push(
            `${file}:${line} — <${/<(\w+)/.exec(tag)?.[1]}> is ${px}px on a phone (${token})`,
          );
        }
      }
    }
  }

  it("are never smaller than 16px", () => {
    expect(offenders).toEqual([]);
  });
});
