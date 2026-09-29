import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `scripts/deploy.sh` asks GitHub about CI before it lets a server pull.
 *
 * The server pulls whatever origin's branch says, and the branch moves the
 * moment something merges — long before CI has finished with it. Deploying
 * then ships a commit nothing has tested, and on an instance that pulls the
 * :preview image, a commit whose image has not been published yet.
 *
 * Run for real, in --dry-run, with `ssh` and `gh` replaced by stubs at the
 * front of PATH: the ssh stub answers the survey the script sends, the gh stub
 * answers with whatever check runs the test gives it, one
 * `name|status|conclusion` line each — which is what the script's own `--jq`
 * would have made of GitHub's answer.
 */

const SCRIPT = path.join(process.cwd(), "scripts", "deploy.sh");
const TARGET = "0123456789abcdef0123456789abcdef01234567";

let dir: string;

const survey = (origin: string): string =>
  [
    "BRANCH main",
    "UPSTREAM origin/main",
    "HEAD abc1234 Add a thing",
    "URL https://balancia.example.com",
    `TARGET ${TARGET}`,
    `ORIGIN ${origin}`,
    "LOG 0123456 Add the next thing",
    "",
  ].join("\n");

function stub(name: string, body: string): void {
  const file = path.join(dir, "bin", name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

function deploy(
  options: {
    checks?: string[];
    ghExit?: number;
    origin?: string;
    args?: string[];
  } = {},
) {
  writeFileSync(
    path.join(dir, "survey"),
    survey(options.origin ?? "git@github.com:sebitr/balancia.git"),
  );
  writeFileSync(
    path.join(dir, "checks"),
    (options.checks ?? []).map((line) => `${line}\n`).join(""),
  );
  stub("ssh", `cat > /dev/null\ncat '${path.join(dir, "survey")}'`);
  stub(
    "gh",
    [
      `printf '%s\\n' "$*" >> '${path.join(dir, "gh.log")}'`,
      `cat '${path.join(dir, "checks")}'`,
      `exit ${options.ghExit ?? 0}`,
    ].join("\n"),
  );

  const result = spawnSync(
    "sh",
    [
      SCRIPT,
      "--dry-run",
      "--no-color",
      "-H",
      "deploy-host",
      ...(options.args ?? []),
    ],
    {
      encoding: "utf8",
      env: { PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}` },
    },
  );
  const log = path.join(dir, "gh.log");
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    gh: existsSync(log) ? readFileSync(log, "utf8") : "",
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "balancia-deploy-"));
  mkdirSync(path.join(dir, "bin"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("deploying only what CI passed", () => {
  it("goes ahead when every check succeeded or did not apply", () => {
    const run = deploy({
      checks: [
        "CI / Docker image|completed|success",
        "Tag and push the manifest|completed|success",
        "Attach the installer to the release|completed|skipped",
      ],
    });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("All 3 checks passed on 0123456.");
    // The commit the server is about to land, in the repository it pulls from.
    expect(run.gh).toContain(
      `api repos/sebitr/balancia/commits/${TARGET}/check-runs?per_page=100`,
    );
  });

  it("stops on a check that failed or was cancelled, and names it", () => {
    const run = deploy({
      checks: [
        "CI / Lint, types and format|completed|success",
        "CI / Playwright journeys|completed|failure",
        "CI / Docker image|completed|cancelled",
      ],
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("CI did not pass on 0123456");
    expect(run.stderr).toContain("CI / Playwright journeys (failure)");
    expect(run.stderr).toContain("CI / Docker image (cancelled)");
    expect(run.stderr).not.toContain("Lint, types and format");
  });

  it("stops while CI is still running", () => {
    const run = deploy({
      checks: [
        "CI / Unit and property tests|completed|success",
        "Build linux/arm64|in_progress|",
      ],
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("CI is still running on 0123456");
    expect(run.stderr).toContain("Build linux/arm64 (in_progress)");
  });

  it("stops when nothing has reported yet", () => {
    const run = deploy({ checks: [] });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Nothing has reported on 0123456 yet");
  });

  it("stops when GitHub cannot be asked", () => {
    const run = deploy({
      checks: ["gh: To get started with GitHub CLI, please run: gh auth login"],
      ghExit: 4,
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Could not read the checks on 0123456");
    expect(run.stderr).toContain("gh auth login");
  });

  it("reads the repository out of every form of GitHub URL", () => {
    for (const origin of [
      "https://github.com/sebitr/balancia.git",
      "https://github.com/sebitr/balancia",
      "ssh://git@github.com/sebitr/balancia.git",
    ]) {
      const run = deploy({
        origin,
        checks: ["CI / Docker image|completed|success"],
      });
      expect(run.status, origin).toBe(0);
      expect(run.gh, origin).toContain("repos/sebitr/balancia/commits/");
      rmSync(path.join(dir, "gh.log"), { force: true });
    }
  });

  it("refuses an origin it cannot ask about", () => {
    const run = deploy({ origin: "git@gitlab.example.com:me/balancia.git" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("not a GitHub repository");
    expect(run.gh).toBe("");
  });

  it("deploys regardless with --skip-checks, and does not ask", () => {
    const run = deploy({
      args: ["--skip-checks"],
      checks: ["CI / Docker image|completed|failure"],
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("--skip-checks");
    expect(run.gh).toBe("");
  });
});
