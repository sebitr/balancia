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
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `scripts/backup.sh`, run for real against a Docker that is not there.
 *
 * docs/backup-and-restore.md described this script for a long time without
 * one existing, so an operator who went looking found a listing to paste and
 * nothing to run — and scripts/deploy.sh had nothing to call before an upgrade
 * either. These tests hold the script to what that page promises.
 *
 * `docker` is a stub at the front of PATH that logs every call and plays the
 * part of each command the script uses. Its `compose exec` reads stdin the way
 * the real one does, because a caller being read from stdin is exactly what
 * deploy.sh is, and one that forgot that would lose the rest of its script.
 */

const SCRIPT = path.join(process.cwd(), "scripts", "backup.sh");
const STAMP = /^\d{8}T\d{6}Z$/;

let dir: string;
let install: string;

function writeDockerStub(): void {
  const log = path.join(dir, "docker.log");
  const flag = (name: string) => `[ -e '${path.join(dir, name)}' ]`;
  const body = [
    `printf '%s\\n' "$*" >> '${log}'`,
    'case "$*" in',
    '  "compose exec -T db pg_dump "*)',
    "    cat > /dev/null",
    `    if ${flag("fail-dump")}; then echo 'pg_dump: error: connection refused' >&2; exit 1; fi`,
    `    if ${flag("garbled-dump")}; then echo 'not an archive'; exit 0; fi`,
    "    printf 'PGDMP fake archive\\n'",
    "    ;;",
    '  "compose exec -T db pg_restore --list"*)',
    "    input=$(cat)",
    "    case $input in PGDMP*) exit 0 ;; esac",
    "    echo 'pg_restore: error: input file does not appear to be a valid archive' >&2",
    "    exit 1",
    "    ;;",
    '  "volume inspect balancia-uploads") exit 0 ;;',
    "  \"run --rm -v balancia-uploads:/data:ro \"*) printf 'fake tarball\\n' ;;",
    "esac",
  ].join("\n");
  const file = path.join(dir, "bin", "docker");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

const ENV_FILE = [
  "AUTH_SECRET=a-secret-that-only-this-instance-has-0123456789",
  "POSTGRES_PASSWORD=another-one",
  "STORAGE_DRIVER=local",
  "",
].join("\n");

function backup(args: string[] = []) {
  const result = spawnSync(
    "bash",
    [path.join(install, "scripts", "backup.sh"), ...args],
    {
      cwd: install,
      encoding: "utf8",
      env: {
        HOME: dir,
        PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}`,
      },
    },
  );
  const log = path.join(dir, "docker.log");
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    docker: existsSync(log) ? readFileSync(log, "utf8") : "",
  };
}

function backups(): string[] {
  const root = path.join(install, "backups");
  return existsSync(root) ? readdirSync(root).sort() : [];
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "balancia-backup-")));
  install = path.join(dir, "balancia");
  mkdirSync(path.join(dir, "bin"));
  mkdirSync(path.join(install, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(install, "scripts", "backup.sh"));
  writeFileSync(path.join(install, "compose.yaml"), "name: balancia\n");
  writeFileSync(path.join(install, ".env"), ENV_FILE);
  writeDockerStub();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("backing up an installation", () => {
  it("writes the database, the receipts and the secrets into one dated directory", () => {
    const run = backup();

    expect(run.status, run.stderr).toBe(0);
    const written = run.stdout.trim();
    expect(path.dirname(written)).toBe(path.join(install, "backups"));
    expect(path.basename(written)).toMatch(STAMP);

    expect(readFileSync(path.join(written, "balancia.dump"), "utf8")).toMatch(
      /^PGDMP/,
    );
    expect(existsSync(path.join(written, "uploads.tar.gz"))).toBe(true);
    expect(readFileSync(path.join(written, "env"), "utf8")).toBe(ENV_FILE);

    // Through the container, in the format that restores selectively.
    expect(run.docker).toContain(
      "compose exec -T db pg_dump -U balancia -d balancia --format=custom --no-owner",
    );
    expect(run.docker).toContain("compose exec -T db pg_restore --list");
  });

  it("writes nothing anybody else on the host can read", () => {
    // The test runner's own umask is the usual 022, which would leave every
    // one of these world-readable without the script's umask 077.
    const written = backup().stdout.trim();

    expect(statSync(written).mode & 0o777).toBe(0o700);
    for (const file of ["balancia.dump", "uploads.tar.gz", "env"]) {
      expect(statSync(path.join(written, file)).mode & 0o777, file).toBe(0o600);
    }
  });

  it("says where the secrets are, and what they are", () => {
    const run = backup();

    expect(run.stderr).toContain("AUTH_SECRET and POSTGRES_PASSWORD");
    expect(run.stderr).toContain("pg_restore");
  });

  it("leaves receipts kept in S3 to the bucket's own backup, and says so", () => {
    writeFileSync(
      path.join(install, ".env"),
      ENV_FILE.replace("STORAGE_DRIVER=local", "STORAGE_DRIVER='s3'") +
        "S3_BUCKET=receipts\n",
    );

    const run = backup();

    expect(run.status, run.stderr).toBe(0);
    const written = run.stdout.trim();
    expect(existsSync(path.join(written, "uploads.tar.gz"))).toBe(false);
    expect(existsSync(path.join(written, "env"))).toBe(true);
    expect(run.docker).not.toContain("balancia-uploads");
    expect(run.stderr).toContain("STORAGE_DRIVER=s3");
    expect(run.stderr).toContain("receipts");
  });

  it("writes the dump and nothing else with --database-only", () => {
    const run = backup(["--database-only"]);

    expect(run.status, run.stderr).toBe(0);
    expect(readdirSync(run.stdout.trim())).toEqual(["balancia.dump"]);
    expect(run.docker).not.toContain("balancia-uploads");
  });

  it("takes a destination relative to where it was started", () => {
    const run = backup(["elsewhere"]);

    expect(run.status, run.stderr).toBe(0);
    expect(path.dirname(run.stdout.trim())).toBe(
      path.join(install, "elsewhere"),
    );
  });
});

describe("a backup that did not work", () => {
  it("fails, and removes what it had started, when pg_dump fails", () => {
    writeFileSync(path.join(dir, "fail-dump"), "");

    const run = backup();

    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("pg_dump failed");
    expect(backups()).toEqual([]);
  });

  it("fails when what came back is not an archive", () => {
    writeFileSync(path.join(dir, "garbled-dump"), "");

    const run = backup();

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("does not read back");
    expect(backups()).toEqual([]);
  });
});

describe("retention", () => {
  const OLD = ["20240101T033000Z", "20250101T033000Z", "20260101T033000Z"];

  beforeEach(() => {
    for (const name of OLD) {
      mkdirSync(path.join(install, "backups", name), { recursive: true });
    }
    writeFileSync(path.join(install, "backups", "notes.txt"), "mine\n");
    mkdirSync(path.join(install, "backups", "before-the-move"));
  });

  it("keeps the newest N, and touches nothing it did not write", () => {
    const run = backup(["--keep", "2"]);

    expect(run.status, run.stderr).toBe(0);
    const written = path.basename(run.stdout.trim());
    expect(backups()).toEqual(
      ["20260101T033000Z", "before-the-move", "notes.txt", written].sort(),
    );
  });

  it("keeps every one of them without --keep", () => {
    const run = backup();

    expect(run.status, run.stderr).toBe(0);
    expect(backups().filter((name) => STAMP.test(name))).toHaveLength(4);
  });

  it("deletes nothing when the backup itself failed", () => {
    writeFileSync(path.join(dir, "fail-dump"), "");

    const run = backup(["--keep", "1"]);

    expect(run.status).not.toBe(0);
    expect(backups().filter((name) => STAMP.test(name))).toEqual(OLD);
  });
});

describe("where backups are kept", () => {
  /**
   * The default destination is inside the installation, which in a checkout
   * is a git working tree and a Docker build context. A dump that git sees is
   * one `git add .` from a commit — and an untracked directory is enough for
   * deploy.sh to refuse the next deploy. One the build context sees is copied
   * into a builder layer by `COPY . .`, secrets and all.
   */
  it("is ignored by git and left out of the image", () => {
    const ignored = spawnSync(
      "git",
      ["check-ignore", "-q", "backups/20260101T033000Z/balancia.dump"],
      { cwd: process.cwd() },
    );
    expect(ignored.status).toBe(0);

    const dockerignore = readFileSync(
      path.join(process.cwd(), ".dockerignore"),
      "utf8",
    ).split("\n");
    expect(dockerignore).toContain("backups");
  });
});
