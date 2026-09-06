import { byRecency, readTodo, TODO_STATES, type TodoState } from "./todo-list";

/**
 * Prints the list that used to live in TODO.md.
 *
 * Nothing renders it into a committed file, and that is the point rather than
 * an omission: a checked-in rendering would be one more file every branch edits
 * at the same two anchors, which is the conflict this directory exists to end.
 * Read it here with `pnpm todo`, or read the directory — the filenames are the
 * slugs, and GitHub lists them.
 */

const HEADINGS: Record<TodoState, string> = {
  now: "Now — started, on a branch, not yet merged",
  next: "Next — agreed on, not started",
  someday: "Someday — worth doing, nobody has committed to it",
  done: "Done — merged",
};

function render(): string {
  const items = readTodo();
  const out: string[] = [];

  for (const state of TODO_STATES) {
    const rows = items.filter((item) => item.state === state).sort(byRecency);
    if (rows.length === 0) continue;

    out.push("", HEADINGS[state], "─".repeat(HEADINGS[state].length));
    for (const item of rows) {
      const pointer =
        item.branch ??
        (item.pullRequest ? `${item.mergedOn} #${item.pullRequest}` : null) ??
        item.see;
      out.push(`• ${item.words}`);
      if (pointer) out.push(`  ${pointer}`);
    }
  }

  return out.join("\n").trimStart();
}

console.log(render());
