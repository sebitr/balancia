import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards on the two workflow files, read as text.
 *
 * Nothing here can run GitHub Actions, and a workflow mistake is invisible
 * until a pull request runs it — or, in release.yml, until the merge after it.
 * What can be checked without running anything is the shape behind two
 * promises. Nothing is published that CI has not passed on the same commit:
 * before this was written down, 31 of 120 merges to main had their image
 * published while CI for that commit failed or was cancelled by the next
 * merge. And nothing runs code its owner can swap out without a commit here:
 * every action used to float on a major tag, one of them with the Docker Hub
 * token in hand.
 *
 * Read with regular expressions rather than a YAML parser, the way
 * env.test.ts reads compose.yaml. The repository has no YAML dependency of its
 * own, and every shape below is a key at a fixed two-space indent.
 */

const WORKFLOWS = path.join(process.cwd(), ".github", "workflows");
const read = (file: string): string =>
  readFileSync(path.join(WORKFLOWS, file), "utf8");

interface Job {
  readonly id: string;
  readonly body: string;
  readonly name: string | undefined;
  readonly needs: readonly string[];
  readonly uses: string | undefined;
}

/** The value of a key at the job's own level — four spaces in. */
function jobKey(body: string, key: string): string | undefined {
  return new RegExp(`^ {4}${key}:[ \\t]*(.*?)[ \\t]*$`, "m").exec(body)?.[1];
}

/** `needs: a`, `needs: [a, b]`, or a block list under `needs:`. */
function parseNeeds(body: string): string[] {
  const inline = jobKey(body, "needs");
  if (inline === undefined) return [];
  if (inline !== "") {
    return inline
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((need) => need.trim())
      .filter(Boolean);
  }
  const block = /^ {4}needs:[ \t]*\n((?: {6}- .*\n)+)/m.exec(body);
  return block
    ? [...block[1].matchAll(/^ {6}- (\S+)/gm)].map((match) => match[1])
    : [];
}

/** Every job under `jobs:`, keyed by id. */
function jobsOf(source: string): Map<string, Job> {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  expect(start, "the workflow has no jobs: block").toBeGreaterThan(-1);

  const jobs = new Map<string, Job>();
  let id: string | undefined;
  let body: string[] = [];
  const flush = (): void => {
    if (id === undefined) return;
    const text = body.join("\n") + "\n";
    jobs.set(id, {
      id,
      body: text,
      name: jobKey(text, "name")?.replace(/^"|"$/g, ""),
      needs: parseNeeds(text),
      uses: jobKey(text, "uses"),
    });
  };

  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      flush();
      id = header[1];
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  return jobs;
}

/** A top-level block — `on:`, `concurrency:` — up to the next top-level key. */
function topLevel(source: string, key: string): string {
  const match = new RegExp(`^${key}:[^\\n]*\\n((?:[ #].*\\n|\\n)*)`, "m").exec(
    source,
  );
  expect(match, `the workflow has no ${key}: block`).not.toBe(null);
  return match![1];
}

const ci = read("ci.yml");
const release = read("release.yml");

describe("publishing waits for CI", () => {
  it("calls CI as a job of the release, on every event it publishes on", () => {
    const job = jobsOf(release).get("ci");

    expect(
      job?.uses,
      "release.yml should call ci.yml as a job named `ci`; that job is the gate",
    ).toBe("./.github/workflows/ci.yml");
    // A condition on the gate is a way round it: a tag push that skipped CI
    // would publish :latest untested.
    expect(jobKey(job!.body, "if")).toBeUndefined();
  });

  it("builds nothing for publishing until that job has passed", () => {
    const jobs = jobsOf(release);

    const waitsForCi = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      const job = jobs.get(id);
      expect(
        job,
        `release.yml names a job it does not have: ${id}`,
      ).toBeDefined();
      return job!.needs.some((need) => need === "ci" || waitsForCi(need, seen));
    };

    const ungated = [...jobs.keys()].filter(
      (id) => id !== "ci" && !waitsForCi(id),
    );

    expect(
      ungated,
      "these jobs in release.yml can run without CI having passed; give each " +
        "a `needs:` that leads back to `ci`",
    ).toEqual([]);
  });

  it("is the only CI run on main, and one release.yml can call", () => {
    const on = topLevel(ci, "on");
    const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map(
      (match) => match[1],
    );

    expect(triggers).toContain("pull_request");
    expect(triggers).toContain("workflow_call");
    // release.yml already runs all of this on every push it publishes from. A
    // push trigger here would be a second run nobody waits for — and the one
    // the next merge used to cancel.
    expect(triggers).not.toContain("push");
  });

  it("cancels superseded pull-request runs and nothing else", () => {
    const concurrency = topLevel(ci, "concurrency");

    expect(concurrency).toMatch(
      /^ {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m,
    );
  });
});

describe("the checks the ruleset requires", () => {
  /**
   * The ruleset on main asks for these by name. A renamed job leaves every pull
   * request waiting on a check that will never report; a job behind an `if:`
   * reports as skipped, which the ruleset accepts as passed.
   */
  const REQUIRED = [
    "Lint, types and format",
    "Unit and property tests",
    "Integration tests",
    "Production build",
    "Playwright journeys",
    "Docker image",
    "Dependency audit",
  ];

  it("names a job in ci.yml after each, and runs it unconditionally", () => {
    const jobs = [...jobsOf(ci).values()];

    for (const name of REQUIRED) {
      const job = jobs.find((candidate) => candidate.name === name);
      expect(job, `ci.yml has no job named "${name}"`).toBeDefined();
      expect(jobKey(job!.body, "if"), `"${name}" runs conditionally`).toBe(
        undefined,
      );
    }
  });
});

describe("the actions it runs", () => {
  const usesLines = readdirSync(WORKFLOWS)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) =>
      [...read(file).matchAll(/^\s*(?:-\s+)?uses:\s*(.+?)\s*$/gm)].map(
        (match) => ({ file, uses: match[1] }),
      ),
    );

  it("finds some to check", () => {
    expect(usesLines.length).toBeGreaterThan(10);
  });

  /**
   * A tag is a pointer its owner can move, so `@v7` runs whatever that
   * repository says v7 is today. A commit cannot move. The version beside it
   * is for the reader and for Dependabot, which rewrites the two together.
   */
  it("pins every one to a full commit, with the release beside it", () => {
    const floating = usesLines.filter(
      ({ uses }) =>
        !uses.startsWith("./") &&
        !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(uses),
    );

    expect(
      floating.map(({ file, uses }) => `${file}: ${uses}`),
      "pin these as owner/repo@<40-character commit> # vX.Y.Z; " +
        "`gh api repos/<owner>/<repo>/git/ref/tags/<tag>` resolves one",
    ).toEqual([]);
  });

  it("leaves Dependabot the job of moving the pins", () => {
    const dependabot = readFileSync(
      path.join(process.cwd(), ".github", "dependabot.yml"),
      "utf8",
    );
    expect(dependabot).toMatch(/package-ecosystem: github-actions/);
  });
});

describe("what the published image carries", () => {
  const jobs = jobsOf(release);

  it("builds each architecture with provenance and an SBOM", () => {
    const build = jobs.get("build")!.body;

    expect(build).not.toMatch(/provenance: false/);
    expect(build).toMatch(/^ {10}provenance: mode=max$/m);
    expect(build).toMatch(/^ {10}sbom: true$/m);
  });

  it("signs the manifest list it tags, and only that job may", () => {
    const publish = jobs.get("publish")!.body;

    expect(publish).toMatch(/uses: actions\/attest@[0-9a-f]{40} /);
    expect(publish).toMatch(
      /subject-digest: \$\{\{ steps\.\w+\.outputs\.digest \}\}/,
    );

    // An OIDC token is a signing identity. The job that attests needs one;
    // no other job should be able to mint it.
    const withIdToken = [...jobs.values()]
      .filter((job) => /^ {6}id-token: write$/m.test(job.body))
      .map((job) => job.id);
    expect(withIdToken).toEqual(["publish"]);
    expect(publish).toMatch(/^ {6}attestations: write$/m);
  });
});

describe("the image CI builds", () => {
  const docker = [...jobsOf(ci).values()].find(
    (job) => job.name === "Docker image",
  )!.body;

  /**
   * It used to check that three files existed and that the user was not root.
   * The entrypoint, the migrator and the worker bundle were never run, so an
   * image that could not reach its database, or could not start its jobs,
   * passed.
   */
  it("boots both roles against a real PostgreSQL", () => {
    expect(docker).toMatch(
      /^ {4}services:\n {6}postgres:\n {8}image: postgres:18/m,
    );
    expect(docker).toContain("/api/health/ready");
    expect(docker).toMatch(/balancia:ci node dist\/worker\.js/);
  });
});
