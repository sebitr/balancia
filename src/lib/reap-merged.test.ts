import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The session-start reaper, run against a throwaway repository.
 *
 * `.claude/hooks/reap-merged.sh` deletes branches, locally and on GitHub, at
 * the start of every session. It used to decide what had merged by name alone,
 * and Weblate pushes every translation pull request from the same branch,
 * `weblate-balancia-messages`. Once #188 had merged under that name, each new
 * Weblate branch was deleted at the next session start and its pull request
 * closed unmerged: #349, #353, #354, #359, #360 and #362.
 *
 * So a branch now goes only when its tip is the very commit a pull request of
 * that name merged at, and never while a pull request of that name is open.
 *
 * Every run here is a `--dry-run`, against a repository whose origin is a bare
 * directory beside it, with a stand-in for `gh` first on the PATH that answers
 * with what the script's `--jq` would have printed. Nothing can reach GitHub.
 */

const SCRIPT = path.join(process.cwd(), ".claude/hooks/reap-merged.sh");

let root = "";
let repo = "";
let env: NodeJS.ProcessEnv = { ...process.env };

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/** A new commit on the branch checked out in `cwd`; returns its id. */
function commit(cwd: string, message: string): string {
  git(cwd, "commit", "--quiet", "--allow-empty", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function reap(extraEnv: Record<string, string> = {}): {
  status: number | null;
  stdout: string;
  would: string[];
} {
  const result = spawnSync("bash", [SCRIPT, "--dry-run"], {
    cwd: repo,
    env: { ...env, ...extraEnv },
    encoding: "utf8",
  });
  const would = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("would "));
  return { status: result.status, stdout: result.stdout, would };
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "reap-merged-")));
  repo = path.join(root, "repo");
  const origin = path.join(root, "origin.git");
  const bin = path.join(root, "bin");
  const forge = path.join(root, "forge");
  mkdirSync(bin);
  mkdirSync(forge);

  // Nobody's git configuration, and no GIT_DIR left over from a hook that
  // happens to be running the tests.
  env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("GIT_")) delete env[name];
  }
  Object.assign(env, {
    HOME: root,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Reaper test",
    GIT_AUTHOR_EMAIL: "reaper@example.test",
    GIT_COMMITTER_NAME: "Reaper test",
    GIT_COMMITTER_EMAIL: "reaper@example.test",
    FAKE_GH: forge,
  });

  writeFileSync(
    path.join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      '[ -n "${FAKE_GH_DOWN:-}" ] && exit 1',
      'case " $* " in',
      '  *" --state merged "*) cat "$FAKE_GH/merged" ;;',
      '  *" --state open "*)   cat "$FAKE_GH/open" ;;',
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(path.join(bin, "gh"), 0o755);

  git(root, "init", "--quiet", "--bare", "-b", "main", origin);
  git(root, "init", "--quiet", "-b", "main", repo);

  // The list as origin/main holds it, one item per case below.
  mkdirSync(path.join(repo, "todo/now"), { recursive: true });
  const item = (slug: string, branch: string) =>
    writeFileSync(
      path.join(repo, `todo/now/${slug}.md`),
      `# ${slug}\n\nBranch: \`${branch}\`\n`,
    );
  item("shipped", "feat/shipped");
  item("long-gone", "feat/long-gone");
  item("reopened", "fix/reopened");
  item("reused", "weblate");
  git(repo, "add", "todo");
  commit(repo, "main");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "--quiet", "-u", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");

  const branch = (name: string) =>
    git(repo, "switch", "--quiet", "-c", name, "main");

  // Merged at its current tip: the one that should go.
  branch("feat/shipped");
  const shipped = commit(repo, "shipped");
  git(repo, "push", "--quiet", "-u", "origin", "feat/shipped");

  // Weblate's case: a pull request of this name merged at an older commit,
  // and the branch has new work on it since.
  branch("weblate");
  const weblateMerged = commit(repo, "first translations");
  commit(repo, "more translations");
  git(repo, "push", "--quiet", "-u", "origin", "weblate");

  // Merged at exactly this tip, and yet a pull request of the name is open.
  branch("fix/reopened");
  const reopened = commit(repo, "reopened");
  git(repo, "push", "--quiet", "-u", "origin", "fix/reopened");

  // Never had a pull request. Its upstream is gone, which is what a merged and
  // pruned branch looks like too — and is not the same thing.
  branch("chore/abandoned");
  commit(repo, "abandoned");
  git(repo, "push", "--quiet", "-u", "origin", "chore/abandoned");
  git(repo, "push", "--quiet", "origin", "--delete", "chore/abandoned");

  git(repo, "switch", "--quiet", "main");

  // Two clean worktrees: one at the commit that merged, one moved on from it.
  const worktree = (name: string, dir: string): string => {
    const where = path.join(root, dir);
    git(repo, "worktree", "add", "--quiet", "-b", name, where, "main");
    return where;
  };
  const wtShipped = commit(worktree("wt/shipped", "wt-shipped"), "shipped");
  const wtReused = worktree("wt/reused", "wt-reused");
  const wtReusedMerged = commit(wtReused, "merged");
  commit(wtReused, "moved on");

  // Branch, number, merge date, commit: what the script's `--jq` prints.
  const merged = [
    ["feat/shipped", "10", "2026-09-01", shipped],
    ["weblate", "5", "2026-08-25", weblateMerged],
    ["fix/reopened", "7", "2026-09-02", reopened],
    ["wt/shipped", "11", "2026-09-03", wtShipped],
    ["wt/reused", "12", "2026-09-04", wtReusedMerged],
    ["feat/long-gone", "3", "2026-08-20", "0".repeat(40)],
  ];
  writeFileSync(
    path.join(forge, "merged"),
    merged.map((row) => row.join("\t") + "\n").join(""),
  );
  writeFileSync(path.join(forge, "open"), "fix/reopened\n");
}, 60_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("the merged-branch reaper", () => {
  it("takes only what merged at the commit it is still at", () => {
    const { status, would } = reap();
    expect(status).toBe(0);
    expect(would).toEqual([
      "would remove worktree wt-shipped (wt/shipped)",
      "would delete local branch feat/shipped",
      "would delete origin/feat/shipped",
    ]);
  }, 30_000);

  it("says why a branch named like a merged one was left", () => {
    const { stdout } = reap();
    const moved = "not at the commit its pull request merged at, left alone";
    const open = "has an open pull request, left alone";
    expect(stdout.split("\n").map((line) => line.trim())).toEqual(
      expect.arrayContaining([
        `wt/reused: ${moved}`,
        `weblate: ${moved}`,
        `origin/weblate: ${moved}`,
        `fix/reopened: ${open}`,
        `origin/fix/reopened: ${open}`,
      ]),
    );
  }, 30_000);

  it("names only the list items whose branch really merged", () => {
    const { stdout } = reap();
    expect(stdout).toContain(
      'shipped.md — feat/shipped merged; file it as "Merged: 2026-09-01 in #10"',
    );
    expect(stdout).toContain(
      'long-gone.md — feat/long-gone merged; file it as "Merged: 2026-08-20 in #3"',
    );
    expect(stdout).not.toContain("reopened.md");
    expect(stdout).not.toContain("reused.md");
  }, 30_000);

  it("deletes nothing when it cannot ask GitHub, and only names the gone", () => {
    // This used to fall back to every branch whose upstream had been deleted,
    // which took chore/abandoned: a branch that never had a pull request.
    const { status, stdout, would } = reap({ FAKE_GH_DOWN: "1" });
    expect(status).toBe(0);
    expect(would).toEqual([]);
    expect(stdout).toContain("nothing was reaped");
    expect(stdout).toMatch(/^ {2}chore\/abandoned$/m);
  }, 30_000);
});
