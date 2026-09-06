import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reading the list, which is a directory of one file per item.
 *
 * It used to be one file, and every branch appended to the head of the same two
 * sections of it — a textual conflict on nearly every pull request. The union
 * merge driver settled that for git and could not settle it for GitHub, whose
 * mergeability check does not read `.gitattributes`, so the banner came back
 * every time main moved while a pull request stayed open. Items in separate
 * files have nothing in common to conflict over, and moving one between states
 * is a rename, which git merges against a contents-only edit without asking.
 *
 * Separate from `todo.ts` so that importing the reader does not print the list:
 * the test imports this, and a module that runs on import is a module that
 * cannot be tested.
 */

export const TODO_STATES = ["now", "next", "someday", "done"] as const;

export type TodoState = (typeof TODO_STATES)[number];

export interface TodoItem {
  readonly state: TodoState;
  readonly slug: string;
  /** The first heading: what changes, in the words a user would recognise. */
  readonly words: string;
  readonly branch: string | null;
  readonly pullRequest: number | null;
  readonly mergedOn: string | null;
  /** The doc or file that explains an item nobody has started. */
  readonly see: string | null;
}

function readState(root: string, state: TodoState): TodoItem[] {
  let names: string[];
  try {
    names = readdirSync(path.join(root, state)).filter((name) =>
      name.endsWith(".md"),
    );
  } catch {
    // A state with no items has no directory, which is an ordinary thing for
    // Someday to be and not worth an error.
    return [];
  }

  return names.map((name) => {
    const source = readFileSync(path.join(root, state, name), "utf8");
    const merged = /^Merged:\s*(\d{4}-\d{2}-\d{2})\s+in\s+#(\d+)\s*$/m.exec(
      source,
    );
    return {
      state,
      slug: name.slice(0, -".md".length),
      words: /^#\s+(.+)$/m.exec(source)?.[1]?.trim() ?? "",
      branch: /^Branch:\s*`([^`]+)`\s*$/m.exec(source)?.[1] ?? null,
      pullRequest: merged ? Number(merged[2]) : null,
      mergedOn: merged ? merged[1]! : null,
      see: /^See:\s*`([^`]+)`\s*$/m.exec(source)?.[1] ?? null,
    };
  });
}

export function readTodo(root = path.join(process.cwd(), "todo")): TodoItem[] {
  return TODO_STATES.flatMap((state) => readState(root, state));
}

/**
 * Newest first where there is a date, and the pull request number breaks a tie
 * — several land on one day, and a directory read in whatever order the
 * filesystem hands back is not an order.
 */
export function byRecency(a: TodoItem, b: TodoItem): number {
  if (a.mergedOn && b.mergedOn) {
    return (
      b.mergedOn.localeCompare(a.mergedOn) ||
      (b.pullRequest ?? 0) - (a.pullRequest ?? 0)
    );
  }
  return a.slug.localeCompare(b.slug);
}
