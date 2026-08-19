import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source files must be text.
 *
 * A single NUL byte typed into a string literal is invisible in an editor and
 * invisible in review — but git decides a file is binary by looking for one,
 * and from then on prints `Bin 23683 -> 24700 bytes` in place of every diff of
 * that file. `src/modules/imports/service.ts` carried one for months, which
 * made the file holding the import fingerprints the one file nobody could read
 * a change to.
 *
 * NUL is a perfectly good separator — it is the one character Postgres will not
 * store in a `text` column. Written as the escape `\u0000` it behaves
 * identically and the file stays readable.
 */

const ROOTS = ["src", "scripts", "tests", "design-system"];
const TEXT = /\.(ts|tsx|mjs|cjs|js|jsx|json|css|md|sh|ya?ml)$/;

function textFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (TEXT.test(entry.name)) {
        found.push(full);
      }
    }
  };

  for (const root of ROOTS) walk(path.join(process.cwd(), root));
  return found;
}

describe("source hygiene", () => {
  it("has no literal NUL byte in a text file", () => {
    const offenders = textFiles()
      .filter((file) => readFileSync(file).includes(0))
      .map((file) => path.relative(process.cwd(), file));

    // Anything listed here is a file git will refuse to diff. Write the byte as
    // the escape `\u0000` instead: the string is identical at runtime.
    expect(offenders).toEqual([]);
  });
});
