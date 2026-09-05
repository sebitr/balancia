import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `.gitattributes` marks TODO.md `merge=union`, because every branch appends to
 * the head of the same two sections and a three-way merge called that a
 * conflict on nearly every pull request. Union merge keeps both sides instead
 * of asking — and says nothing when it does. Move a line from **Now** to
 * **Done** while another branch appends beside it and the **Now** copy can
 * survive, leaving one item in two sections at once with no marker on it.
 *
 * Nothing else would catch that, so this does. Two signals find the same
 * accident from either end: a line that landed in the wrong section still
 * carries the wrong section's pointer, and an item keeps its words when it
 * moves, so a resurrected line is a second copy of a text already seen.
 */
const SOURCE = readFileSync(path.join(process.cwd(), "TODO.md"), "utf8");

/** The sections that hold items. _Keeping the list_ is prose about them. */
const LIST_SECTIONS = ["Now", "Next", "Someday", "Done"] as const;

type Item = {
  section: string;
  line: number;
  raw: string;
  /** The words, with the tick, the merge date and the pointer taken off. */
  words: string;
};

function parse(): Item[] {
  const items: Item[] = [];
  let section = "";
  let fenced = false;

  SOURCE.split("\n").forEach((raw, index) => {
    if (raw.startsWith("```")) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;

    const heading = /^## (.+)$/.exec(raw);
    if (heading) {
      section = heading[1]!;
      return;
    }

    const item = /^- \[[ x]\] (.+)$/.exec(raw);
    if (!item) return;
    if (!(LIST_SECTIONS as readonly string[]).includes(section)) return;

    const words = item[1]!
      .replace(/^\d{4}-\d{2}-\d{2} /, "")
      .replace(/ — (?:`[^`]+`|#\d+)$/, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

    items.push({ section, line: index + 1, raw, words });
  });

  return items;
}

const ITEMS = parse();

describe("TODO.md", () => {
  it("parses the list at all", () => {
    expect(
      ITEMS.length,
      "no items parsed — the headings or the item form moved",
    ).toBeGreaterThan(0);
    expect(
      ITEMS.some((item) => item.section === "Done"),
      "nothing parsed under ## Done, which is never empty for long",
    ).toBe(true);
  });

  /**
   * The one union merge cannot be trusted with. An item that shipped is written
   * once, under **Done**; finding its words twice means a merge put it back.
   */
  it("writes each item once", () => {
    const seen = new Map<string, Item>();
    for (const item of ITEMS) {
      const first = seen.get(item.words);
      expect(
        first,
        first &&
          `two items share their words — union merge duplicates a line rather ` +
            `than conflicting on it, and this is what that looks like:\n` +
            `  ## ${first.section}, line ${first.line}: ${first.raw}\n` +
            `  ## ${item.section}, line ${item.line}: ${item.raw}`,
      ).toBeUndefined();
      seen.set(item.words, item);
    }
  });

  /**
   * A line that union merge moved between sections keeps the pointer it had, so
   * the pointer says which section a line belongs in even when the words match
   * nothing.
   */
  it("points started work at a branch and finished work at a pull request", () => {
    for (const item of ITEMS.filter((entry) => entry.section === "Now")) {
      expect(
        item.raw,
        `## Now, line ${item.line}: an item that has started ends with its ` +
          `branch in backticks. A pull request number here means a finished ` +
          `item came back:\n  ${item.raw}`,
      ).toMatch(/^- \[ \] .+ — `[^`]+`$/);
    }

    for (const item of ITEMS.filter((entry) => entry.section === "Done")) {
      expect(
        item.raw,
        `## Done, line ${item.line}: a merged item is ticked, dated, and ends ` +
          `with its pull request number:\n  ${item.raw}`,
      ).toMatch(/^- \[x\] \d{4}-\d{2}-\d{2} .+ — #\d+$/);
    }
  });

  /** Two chats on one branch is the thing **Now** exists to prevent. */
  it("claims each branch once", () => {
    const claims = new Map<string, number>();
    for (const item of ITEMS.filter((entry) => entry.section === "Now")) {
      const branch = /— `([^`]+)`$/.exec(item.raw)?.[1];
      if (!branch) continue;
      const first = claims.get(branch);
      expect(
        first,
        first === undefined
          ? undefined
          : `\`${branch}\` is claimed by two items, on lines ${first} and ` +
              `${item.line}`,
      ).toBeUndefined();
      claims.set(branch, item.line);
    }
  });
});
