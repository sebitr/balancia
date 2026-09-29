import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `scripts/deploy.sh` takes a restore point before it restarts anything.
 *
 * Migrations only go forwards, and the image's entrypoint applies them the
 * moment `up` starts it. docs/self-hosting.md has always said the way back is
 * to restore the pre-upgrade dump — and until now nothing took one, so a bad
 * migration on the hosted instance had nothing to go back to.
 *
 * Run for real, both halves of it. The "server" is a git clone in a temporary
 * directory, one commit behind an origin that has just gained a migration.
 * `ssh` is a stub that runs the remote half locally, on the same stdin the
 * real one would get it on; `docker` is a stub that logs every call and plays
 * pg_dump, pg_restore and Compose. Its `compose exec` reads stdin, as the real
 * one does, so a deploy that let the backup read its script would never reach
 * `up`. And backup.sh is the real one, committed into the fake checkout.
 */

const REPO = process.cwd();

let dir: string;
let work: string;
let server: string;

const gitEnv = (): NodeJS.ProcessEnv => ({
  // Nothing from the calling user's git configuration: commit signing, hooks
  // or a default branch of their own would each change what happens here.
  HOME: dir,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Balancia tests",
  GIT_AUTHOR_EMAIL: "tests@balancia.invalid",
  GIT_COMMITTER_NAME: "Balancia tests",
  GIT_COMMITTER_EMAIL: "tests@balancia.invalid",
  PATH: process.env.PATH ?? "",
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

function stub(name: string, body: string): void {
  const file = path.join(dir, "bin", name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

function deploy(args: string[] = []) {
  const result = spawnSync(
    "sh",
    [
      path.join(REPO, "scripts", "deploy.sh"),
      "--no-color",
      "-H",
      "deploy-host",
      "-C",
      server,
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        ...gitEnv(),
        NODE_ENV: "test",
        PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}`,
      },
    },
  );
  const log = path.join(dir, "docker.log");
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.stdout + result.stderr,
    docker: existsSync(log) ? readFileSync(log, "utf8").split("\n") : [],
  };
}

function restorePoints(): string[] {
  const root = path.join(server, "backups", "pre-deploy");
  return existsSync(root)
    ? readdirSync(root).filter((name) => /^\d{8}T\d{6}Z$/.test(name))
    : [];
}

const called = (lines: string[], command: string): number =>
  lines.findIndex((line) => line.startsWith(command));

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "balancia-deploy-")));
  mkdirSync(path.join(dir, "bin"));

  // Under a github.com/ path so that a deploy which also asks GitHub about
  // CI reads it as the repository sebitr/balancia; the gh stub below answers
  // for it, and nothing here ever reaches the network.
  const origin = path.join(dir, "github.com", "sebitr", "balancia.git");
  mkdirSync(origin, { recursive: true });
  git(origin, "init", "--quiet", "--bare", "--initial-branch=main");

  work = path.join(dir, "work");
  mkdirSync(path.join(work, "scripts"), { recursive: true });
  mkdirSync(path.join(work, "drizzle"));
  writeFileSync(path.join(work, "compose.yaml"), "name: balancia\n");
  // The real ones: whether a restore point leaves the checkout clean enough
  // for the next deploy is a property of the real .gitignore.
  copyFileSync(path.join(REPO, ".gitignore"), path.join(work, ".gitignore"));
  copyFileSync(
    path.join(REPO, "scripts", "backup.sh"),
    path.join(work, "scripts", "backup.sh"),
  );
  chmodSync(path.join(work, "scripts", "backup.sh"), 0o755);
  writeFileSync(
    path.join(work, "drizzle", "0000_init.sql"),
    "CREATE TABLE t ();\n",
  );
  git(work, "init", "--quiet", "--initial-branch=main");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "First");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "--quiet", "-u", "origin", "main");

  server = path.join(dir, "server");
  git(dir, "clone", "--quiet", origin, server);
  writeFileSync(
    path.join(server, ".env"),
    "APP_URL=https://balancia.example.com\nPOSTGRES_PASSWORD=secret\n",
  );

  // What is about to be deployed: a migration.
  writeFileSync(
    path.join(work, "drizzle", "0001_next.sql"),
    "ALTER TABLE t ADD COLUMN c int;\n",
  );
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "Add a column");
  git(work, "push", "--quiet");

  stub("ssh", 'for arg; do last=$arg; done\nexec sh -c "$last"');
  stub("gh", "echo 'CI / Docker image|completed|success'");

  const log = path.join(dir, "docker.log");
  const failDump = path.join(dir, "fail-dump");
  stub(
    "docker",
    [
      `printf '%s\\n' "$*" >> '${log}'`,
      'case "$*" in',
      '  "compose exec -T db pg_dump "*)',
      "    cat > /dev/null",
      `    if [ -e '${failDump}' ]; then echo 'pg_dump: error: could not connect' >&2; exit 1; fi`,
      "    printf 'PGDMP fake archive\\n'",
      "    ;;",
      '  "compose exec -T db pg_restore --list"*) cat > /dev/null ;;',
      '  "compose ps -a --format {{.Service}}|"*)',
      "    printf 'app|running|healthy\\ndb|running|healthy\\n'",
      "    ;;",
      "esac",
      "exit 0",
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("a restore point before every deploy", () => {
  it("dumps the database after the pull and before anything restarts", () => {
    const run = deploy();

    expect(run.status, run.output).toBe(0);
    // The migration landed…
    expect(existsSync(path.join(server, "drizzle", "0001_next.sql"))).toBe(
      true,
    );
    // …and the dump was taken before the image that would apply it was
    // fetched, let alone started.
    const dump = called(run.docker, "compose exec -T db pg_dump");
    expect(dump).toBeGreaterThan(-1);
    expect(dump).toBeLessThan(called(run.docker, "compose pull"));
    expect(dump).toBeLessThan(called(run.docker, "compose up -d --build"));

    const [point] = restorePoints();
    const file = path.join(
      server,
      "backups",
      "pre-deploy",
      point,
      "balancia.dump",
    );
    expect(readFileSync(file, "utf8")).toMatch(/^PGDMP/);
    // Where it went, and how to go back to it, at the end of the output.
    expect(run.stdout).toContain(`Restore point: ${file}`);
    expect(run.stdout).toContain(`--create --no-owner < '${file}'`);
  });

  it("stops before anything restarts when the dump fails", () => {
    writeFileSync(path.join(dir, "fail-dump"), "");

    const run = deploy();

    expect(run.status).toBe(3);
    expect(called(run.docker, "compose exec -T db pg_dump")).toBeGreaterThan(
      -1,
    );
    expect(called(run.docker, "compose pull")).toBe(-1);
    expect(called(run.docker, "compose up")).toBe(-1);
    expect(run.output).toContain("nothing was restarted");
    expect(run.output).toContain("--skip-backup");
    expect(restorePoints()).toEqual([]);
  });

  it("goes ahead without one when told to with --skip-backup", () => {
    writeFileSync(path.join(dir, "fail-dump"), "");

    const run = deploy(["--skip-backup"]);

    expect(run.status, run.output).toBe(0);
    expect(called(run.docker, "compose exec -T db pg_dump")).toBe(-1);
    expect(called(run.docker, "compose up -d --build")).toBeGreaterThan(-1);
    expect(run.stdout).toContain("No restore point taken: --skip-backup.");
    expect(run.stdout).not.toContain("Restore point:");
  });

  it("leaves the checkout clean enough for the next deploy", () => {
    // The survey refuses a working tree with anything untracked in it, and
    // the restore point is written inside the checkout.
    expect(deploy().status).toBe(0);

    const again = deploy();

    expect(again.status, again.output).toBe(0);
    expect(again.stdout).toContain("Nothing to pull");
    expect(restorePoints().length).toBeGreaterThanOrEqual(1);
  });
});
