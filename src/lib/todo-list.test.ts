import { describe, expect, it } from "vitest";
import { readTodo, type TodoItem } from "../../scripts/todo-list";

/**
 * Guards on the list, which is a directory of one file per item.
 *
 * It used to be one file, and most of what this test did was catch what union
 * merge broke: a line resurrected in **Now** after it had moved to **Done**,
 * because union merge keeps both sides and has no way to express a deletion.
 * That class of accident is gone by construction. Moving an item is a rename
 * now, and git merges a rename against a branch that only edited the file's
 * contents without asking anybody.
 *
 * What is left is what the shape cannot enforce on its own. An item is only
 * useful to somebody who was not in the chat that wrote it if it says what
 * changes and points at something — a branch while it is being done, a pull
 * request once it has merged. And two chats claiming one branch is the thing
 * **Now** exists to prevent, which no filesystem rule catches.
 */

const ITEMS = readTodo();
const inState = (state: TodoItem["state"]): TodoItem[] =>
  ITEMS.filter((item) => item.state === state);

describe("the list", () => {
  it("parses at all", () => {
    expect(
      ITEMS.length,
      "no items read — todo/ moved, or the item form did",
    ).toBeGreaterThan(0);
    expect(
      inState("done").length,
      "nothing under todo/done, which is never empty for long",
    ).toBeGreaterThan(0);
  });

  it("says what changes, in every item", () => {
    for (const item of ITEMS) {
      expect(
        item.words,
        `todo/${item.state}/${item.slug}.md has no heading. The first line is ` +
          `what changes, in the words a user would recognise.`,
      ).not.toBe("");
    }
  });

  it("holds each item in one state only", () => {
    // A file cannot be in two directories, so this only fires when somebody
    // copies rather than moves — which is the one way back to an item that
    // says it is both in flight and finished.
    const seen = new Map<string, TodoItem>();
    for (const item of ITEMS) {
      const first = seen.get(item.slug);
      expect(
        first,
        first &&
          `\`${item.slug}\` is in two states at once — todo/${first.state}/ ` +
            `and todo/${item.state}/. Moving an item is a rename, not a copy.`,
      ).toBeUndefined();
      seen.set(item.slug, item);
    }
  });

  it("points started work at a branch", () => {
    for (const item of inState("now")) {
      expect(
        item.branch,
        `todo/now/${item.slug}.md needs a "Branch: \`name\`" line. Several ` +
          `chats work this repository at once, in separate worktrees, and the ` +
          `branch is the only way to see that a thing is already being done.`,
      ).not.toBeNull();
      expect(
        item.pullRequest,
        `todo/now/${item.slug}.md carries a pull request number, so it has ` +
          `merged and belongs in todo/done/.`,
      ).toBeNull();
    }
  });

  it("points finished work at a pull request, with the date it merged", () => {
    for (const item of inState("done")) {
      expect(
        item.pullRequest,
        `todo/done/${item.slug}.md needs a "Merged: YYYY-MM-DD in #123" line.`,
      ).not.toBeNull();
      expect(
        item.branch,
        `todo/done/${item.slug}.md still names a branch. A merged item is ` +
          `pointed at its pull request; the branch has been reaped.`,
      ).toBeNull();
    }
  });

  it("claims each branch once", () => {
    const claims = new Map<string, string>();
    for (const item of inState("now")) {
      if (!item.branch) continue;
      const first = claims.get(item.branch);
      expect(
        first,
        first === undefined
          ? undefined
          : `\`${item.branch}\` is claimed by two items, ${first} and ` +
              `${item.slug}. One branch, one topic, one item.`,
      ).toBeUndefined();
      claims.set(item.branch, item.slug);
    }
  });

  it("keeps nothing where the old single file was", async () => {
    // The rendering is produced on demand by `pnpm todo` and never committed.
    // A checked-in copy would be one more file every branch edits at the same
    // two anchors, which is the conflict this directory exists to end.
    const { existsSync } = await import("node:fs");
    expect(
      existsSync("TODO.md"),
      "TODO.md is back. The list is todo/, and a committed rendering of it " +
        "recreates the conflict that split it up.",
    ).toBe(false);
  });
});
