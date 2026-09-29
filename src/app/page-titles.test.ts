import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every screen inside a group, and every settings screen, has a title.
 *
 * Seven of a group's main screens — the overview, the transactions, an
 * expense, a repayment, the recurring list, the import and the group's own
 * settings — had none, and fell back to the root layout's "Balancia". So the
 * browser tab, the history list and the screen reader's announcement on
 * arriving all said the same word whichever of them had opened, which is what
 * WCAG 2.4.2 is about. People, activity, settle up and statistics had titles
 * already; nothing said the rest must.
 *
 * Read from the source rather than rendered, because a title is an export and
 * the thing that goes missing is the export.
 *
 * The drawer routes the `@entry` slot intercepts are the one deliberate gap,
 * and the second half of this pins it: a slot keeps rendering its page after
 * the reader has navigated away from it (see `entry-screen.tsx`), so a title
 * from there would go on naming a drawer that had already closed.
 */

const APP = join(process.cwd(), "src", "app");
const COVERED = [join(APP, "groups", "[groupId]"), join(APP, "settings")];

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

const TITLED = /export (?:async function generateMetadata\b|const metadata\b)/;

const inSlot = (path: string) => /[\\/]@[^\\/]+[\\/]/.test(path);

describe("page titles", () => {
  it("are given by every group and settings screen", () => {
    const untitled = COVERED.flatMap(pages)
      .filter((path) => !inSlot(path))
      .filter((path) => !TITLED.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path));

    expect(untitled).toEqual([]);
  });

  it("are never given by a drawer the entry slot intercepts", () => {
    const titledSlots = pages(join(APP, "groups", "[groupId]"))
      .filter(inSlot)
      .filter((path) => TITLED.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path));

    expect(titledSlots).toEqual([]);
  });
});
