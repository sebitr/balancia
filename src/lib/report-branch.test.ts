import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The session-start branch report, run against a throwaway repository.
 *
 * Besides saying which branch a session is on, `.claude/hooks/report-branch.sh`
 * names work that exists on this machine only and has sat for a week: a branch
 * no remote has, and a worktree whose uncommitted changes nobody has touched.
 * Nothing else ever mentions either — the reaper rightly leaves a branch with
 * no pull request alone — and that is how a security fix stayed unpushed for
 * six weeks while the code it fixed was live.
 */

const SCRIPT = path.join(process.cwd(), ".claude/hooks/report-branch.sh");
const OLD = "2026-01-01T12:00:00Z";

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

function commitAt(cwd: string, message: string, when?: string): void {
  const dated = when
    ? { ...env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }
    : env;
  const result = spawnSync(
    "git",
    ["commit", "--quiet", "--allow-empty", "-m", message],
    { cwd, env: dated, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr);
}

function report(): string {
  const result = spawnSync("bash", [SCRIPT], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput: { additionalContext: string };
  };
  return parsed.hookSpecificOutput.additionalContext;
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "report-branch-")));
  repo = path.join(root, "repo");
  const origin = path.join(root, "origin.git");

  env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("GIT_")) delete env[name];
  }
  Object.assign(env, {
    HOME: root,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Report test",
    GIT_AUTHOR_EMAIL: "report@example.test",
    GIT_COMMITTER_NAME: "Report test",
    GIT_COMMITTER_EMAIL: "report@example.test",
  });

  git(root, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  git(root, "clone", "--quiet", origin, repo);
  git(repo, "checkout", "--quiet", "-b", "main");
  commitAt(repo, "start", OLD);
  git(repo, "push", "--quiet", "-u", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");

  // Pushed, old: its commits are on the remote, so it is not stranded.
  git(repo, "branch", "pushed-old");
  git(repo, "checkout", "--quiet", "pushed-old");
  commitAt(repo, "pushed", OLD);
  git(repo, "push", "--quiet", "-u", "origin", "pushed-old");

  // Never pushed, quiet since January: the one to name.
  git(repo, "checkout", "--quiet", "-b", "stranded-old", "main");
  commitAt(repo, "forgotten fix", OLD);

  // Never pushed, but committed today: somebody is on it.
  git(repo, "checkout", "--quiet", "-b", "unpushed-fresh", "main");
  commitAt(repo, "in progress");

  // No commits of its own: nothing to lose.
  git(repo, "branch", "empty-old", "main");

  git(repo, "checkout", "--quiet", "main");

  // A worktree whose uncommitted file nobody has touched since January.
  const idle = path.join(root, "idle-tree");
  git(repo, "worktree", "add", "--quiet", "-b", "idle-tree", idle, "main");
  const forgotten = path.join(idle, "forgotten.ts");
  writeFileSync(forgotten, "export {};\n");
  const january = new Date(OLD);
  utimesSync(forgotten, january, january);

  // A worktree being edited right now.
  const busy = path.join(root, "busy-tree");
  git(repo, "worktree", "add", "--quiet", "-b", "busy-tree", busy, "main");
  writeFileSync(path.join(busy, "today.ts"), "export {};\n");
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("work on this machine only", () => {
  it("names a branch no remote has that has not moved for a week", () => {
    const text = report();
    expect(text).toContain("Branches never pushed:");
    expect(text).toMatch(/^ {2}stranded-old \(last commit 2026-01-01\)$/m);
  });

  it("leaves out a pushed branch, a fresh one, one with nothing of its own, and main", () => {
    const listed = report().split("Branches never pushed:")[1] ?? "";
    const section = listed.split("Worktrees with uncommitted changes:")[0];
    for (const name of [
      "pushed-old",
      "unpushed-fresh",
      "empty-old",
      "idle-tree",
      "busy-tree",
      "main",
    ]) {
      expect(section, name).not.toMatch(new RegExp(`^ {2}${name} `, "m"));
    }
  });

  it("names a worktree whose uncommitted changes nobody has touched for a week", () => {
    const text = report();
    expect(text).toContain("Worktrees with uncommitted changes:");
    expect(text).toMatch(
      /^ {2}\S*idle-tree \(1 uncommitted file\(s\), untouched since 2026-01-01\)$/m,
    );
    expect(text).not.toMatch(/busy-tree \(/);
  });

  it("asks the session to tell the person rather than act", () => {
    expect(report()).toMatch(
      /do not\s+push, commit, delete or continue it without their word/,
    );
  });
});
