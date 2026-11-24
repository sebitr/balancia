import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A focus ring is full strength.
 *
 * `--ring` is the accent's ink, held to 4.5:1 on every surface by
 * `token-contrast.test.ts`. `ring-ring/50` halves its opacity and drops the
 * ring under the 3:1 WCAG 1.4.11 asks of a focus indicator, which is how some
 * sixty call sites kept a ring nobody could see on a pale card. Write
 * `focus-visible:ring-3 focus-visible:ring-ring` instead.
 *
 * Add to ALLOWED only a `ring-ring/<n>` that is not a focus indicator.
 */
const ALLOWED: { file: string; why: string }[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("focus rings", () => {
  it("never fade --ring with an opacity suffix", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
      if (file.endsWith("focus-ring.test.ts")) continue;
      if (ALLOWED.some((one) => one.file === file)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((text, i) => {
          if (/(?:ring|outline)-ring\/\d+/.test(text)) {
            offenders.push(`${file}:${i + 1} — ${text.trim().slice(0, 100)}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
