import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A surface a shade off the one behind it is `bg-wash-1` … `bg-wash-4`, and a
 * hairline is `shadow-hairline`. Neither is written by hand.
 *
 * The app had been writing both by hand, and half of it was wrong in the
 * light theme. `shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]` — a *white* ring —
 * appeared at fourteen sites; it drew nothing at all on cream, so every one of
 * those cards had a crisp edge at night and none by day. `bg-white/4` and its
 * relatives did the same thing at nineteen more. Alongside them
 * `bg-foreground/[0.0x]` was theme-correct but spelled at eight different
 * alphas between 0.035 and 0.12, three of which sat inside a single file.
 *
 * `--wash-1` … `--wash-4` are four steps mixed from `--foreground`, so they
 * follow the theme, and `--shadow-hairline` is `var(--border)` drawn as a
 * shadow, so it is the line the rest of the app uses. This file is why they
 * stay the only way to say it.
 *
 * `bg-black/…` is left alone: a dialog scrim and a drawing of a paper receipt
 * are deliberately the same colour in both themes, and both are listed below.
 * The marketing pages are not covered — an editorial surface with its own
 * palette, per `AGENTS.md`.
 */

/** Marketing is editorial and keeps its own palette. */
const UNCOVERED = ["src/components/marketing", "src/app/page.tsx"];

/** Colours that are a brand's or an object's, not the theme's. */
const EXEMPT: { file: string; why: string }[] = [
  {
    file: "src/components/auth/apple-sign-in-button.tsx",
    why: "Apple's sign-in button is black on light and white on dark by their guidelines",
  },
  {
    file: "src/components/entries/receipt-blocks.tsx",
    why: "a drawn stand-in for a paper receipt: white paper, dark print, in both themes",
  },
  {
    file: "src/components/ui/dialog.tsx",
    why: "the scrim behind a dialog is the absence of a surface, and the same in both themes",
  },
  {
    file: "src/components/ui/alert-dialog.tsx",
    why: "as dialog.tsx",
  },
  {
    file: "src/components/ui/sheet.tsx",
    why: "as dialog.tsx",
  },
];

const BANNED: { pattern: RegExp; instead: string }[] = [
  {
    pattern: /\b(?:hover:|active:|focus:|group-hover:|dark:)?bg-white\/\d+\b/g,
    instead: "bg-wash-1 … bg-wash-4, which are mixed from --foreground",
  },
  {
    pattern: /\b(?:hover:|active:|focus:|group-hover:|dark:)?bg-black\/\d+\b/g,
    instead: "bg-wash-1 … bg-wash-4, which are mixed from --foreground",
  },
  {
    pattern: /\bborder-(?:white|black)\/\d+\b/g,
    instead: "border-border, or border-input where the line has to carry",
  },
  {
    pattern: /\bbg-foreground\/\[[\d.]+\]/g,
    instead: "one of the four wash steps",
  },
  {
    pattern: /shadow-\[[^\]]*oklch\(1_0_0[^\]]*\]/g,
    instead: "shadow-hairline or shadow-hairline-inset",
  },
];

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

/** Comments are stripped, or prose explaining the rule reads as a use of it. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

describe("surfaces and hairlines", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles("src")) {
    if (EXEMPT.some((one) => one.file === file)) continue;
    const source = withoutComments(readFileSync(file, "utf8"));
    for (const { pattern, instead } of BANNED) {
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line} — ${match[0]}; use ${instead}`);
      }
    }
  }

  it("are never written by hand", () => {
    expect(offenders).toEqual([]);
  });

  it("keep the exemption list honest", () => {
    // An exemption for a file that no longer needs one is a licence nobody
    // asked for, and the next white wash added to it would go unnoticed.
    for (const { file } of EXEMPT) {
      const source = withoutComments(readFileSync(file, "utf8"));
      const uses = BANNED.some(({ pattern }) => pattern.test(source));
      // `pattern` is a /g regex shared across files; reset before the next.
      for (const { pattern } of BANNED) pattern.lastIndex = 0;
      expect(uses, `${file} no longer needs its exemption`).toBe(true);
    }
  });
});
