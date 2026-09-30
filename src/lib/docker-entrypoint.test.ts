import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the production image's entrypoint reads, and whether Compose hands it
 * over.
 *
 * `env.test.ts` holds compose.yaml to every variable in the schema, and that
 * is exactly the gap `RUN_MIGRATIONS` fell through: the application never
 * reads it — scripts/docker-entrypoint.sh does, before the application starts
 * — so it was in no schema and on no list. The docs said to set it in `.env`
 * to take migrations over, compose.yaml did not name it, and the containers
 * went on migrating on every start whatever `.env` said. This is the same
 * test for the other reader of the containers' environment.
 *
 * Read as text, as env.test.ts and restore-drill.test.ts read these files:
 * the repository has no YAML parser of its own, and the two shapes that
 * matter — `${NAME…}` in a shell script, and a service's `environment:`
 * merged in from an anchor — are small enough to read line by line.
 */

const ENTRYPOINT = path.join("scripts", "docker-entrypoint.sh");

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

/**
 * Every variable the entrypoint takes from its environment: `$NAME` and
 * `${NAME…}` in the shell, and `process.env.NAME` in the one line of Node it
 * runs. Comments go first — the header names `RUN_MIGRATIONS` in prose, and
 * prose is not a read. The script's own variables are lower case, so a name
 * in capitals is one that came from outside.
 */
function entrypointReads(): string[] {
  const code = read(ENTRYPOINT).replace(/(^|\s)#.*$/gm, "$1");
  const names = [
    ...code.matchAll(/\$\{?([A-Z][A-Z0-9_]*)/g),
    ...code.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g),
  ].map((match) => match[1]!);
  return [...new Set(names)].sort();
}

interface Service {
  /** `build.dockerfile`: `Dockerfile` is the image this entrypoint is in. */
  dockerfile?: string;
  /** Each name as written: `${NAME:-default}`, or a literal. */
  environment: Record<string, string>;
}

/**
 * The services of a Compose file, with the environment each is given. A
 * mapping merged in from an anchor (`<<: *app-environment`) counts as written
 * where it is merged.
 */
function composeServices(file: string): Record<string, Service> {
  const anchors: Record<string, Record<string, string>> = {};
  const services: Record<string, Service> = {};

  let section = "";
  let anchor: Record<string, string> | undefined;
  let service: Service | undefined;
  let field = "";

  for (const line of read(file).split("\n")) {
    const content = line.trim();
    if (content === "" || content.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    const merge = /^<<:\s*\*(\S+)$/.exec(content);
    const entry = /^([\w.-]+):(?:\s+(.*))?$/.exec(content);
    const key = entry?.[1] ?? "";
    const rest = entry?.[2] ?? "";

    if (indent === 0 && entry) {
      section = key;
      const name = /^&(\S+)$/.exec(rest)?.[1];
      anchor = name ? (anchors[name] = {}) : undefined;
    } else if (indent === 2 && entry) {
      if (anchor) anchor[key] = rest;
      service =
        section === "services"
          ? (services[key] = { environment: {} })
          : undefined;
    } else if (indent === 4 && service) {
      field = key;
    } else if (indent === 6 && service) {
      if (field === "build" && key === "dockerfile") service.dockerfile = rest;
      if (field === "environment" && merge) {
        Object.assign(service.environment, anchors[merge[1]!]);
      } else if (field === "environment" && entry) {
        service.environment[key] = rest;
      }
    }
  }

  return services;
}

/** Whether the service takes this variable from `.env`, under its own name. */
function fromDotEnv(service: Service, name: string): boolean {
  return new RegExp(`^\\$\\{${name}(\\}|:?[-?])`).test(
    service.environment[name] ?? "",
  );
}

/**
 * Read by the entrypoint and deliberately not taken from `.env` under
 * Compose, each with its reason. A name belongs here only if an operator
 * setting it in `.env` is *meant* to have no effect — whether compose.yaml
 * leaves it out or writes a literal in its place.
 *
 * The four below are for `docker run` beside some other PostgreSQL — CI's
 * image check passes POSTGRES_HOST that way. Under Compose each is half of a
 * connection string whose other half is the `db` service in the same file,
 * which reads none of them, so forwarding one would move the app's half
 * alone. A database somewhere else is `DATABASE_URL`, which is forwarded.
 */
const NOT_FROM_DOT_ENV: Readonly<Record<string, string>> = {
  POSTGRES_USER:
    "the db service creates its role as `balancia`, literally — the default here",
  POSTGRES_DB:
    "the db service creates its database as `balancia`, literally — the default here",
  POSTGRES_HOST:
    "`db`, the service's name on the project network, which only this file can change",
  POSTGRES_PORT:
    "5432, where PostgreSQL listens inside that network; DB_PORT is the host's side, which the app never uses",
};

const COMPOSE = composeServices("compose.yaml");

/** The services that run the production image, and so its entrypoint. */
const IMAGE_SERVICES = Object.entries(COMPOSE).filter(
  ([, service]) => service.dockerfile === "Dockerfile",
);

describe("configuration reaches the entrypoint", () => {
  it("runs it in the app and the worker", () => {
    // compose.image.yaml swaps where these two get their image and nothing
    // else, and compose.drill.yaml is laid over this file too: both inherit
    // the environment read here.
    expect(IMAGE_SERVICES.map(([name]) => name)).toEqual(["app", "worker"]);
  });

  it("hands the entrypoint every variable it reads", () => {
    const reads = entrypointReads();
    // The finding, by name, so that a scan which stopped seeing anything
    // cannot pass by finding nothing to check.
    expect(reads).toContain("RUN_MIGRATIONS");

    for (const [name, service] of IMAGE_SERVICES) {
      const missing = reads.filter(
        (variable) =>
          !(variable in NOT_FROM_DOT_ENV) && !fromDotEnv(service, variable),
      );

      // The failure message is the fix, as in env.test.ts.
      expect(
        missing,
        `compose.yaml does not pass these from .env to ${name}, so the ` +
          `entrypoint never sees a value set there. Add under ` +
          `x-app-environment:\n` +
          missing
            .map((variable) => `  ${variable}: \${${variable}:-}`)
            .join("\n"),
      ).toEqual([]);
    }
  });

  it("keeps the withheld list honest", () => {
    const reads = new Set(entrypointReads());

    // A name the entrypoint no longer reads, or one compose.yaml has started
    // forwarding after all, has to leave the list, or the list stops meaning
    // anything.
    const stale = Object.keys(NOT_FROM_DOT_ENV).filter(
      (name) =>
        !reads.has(name) ||
        IMAGE_SERVICES.some(([, service]) => fromDotEnv(service, name)),
    );

    expect(
      stale,
      "these are in NOT_FROM_DOT_ENV but no longer belong there; delete their lines",
    ).toEqual([]);
  });

  /**
   * compose.demo.yaml builds the same image and runs the same entrypoint, and
   * takes none of this from `.env`, on purpose. It has no database for the
   * POSTGRES_ settings to describe; it leaves both model switches off, so the
   * warnings they drive have nothing to say; and it fixes DEMO_MODE on —
   * which the entrypoint checks before RUN_MIGRATIONS, and which skips the
   * migration step whatever that says. That last holds only while DEMO_MODE
   * is a literal there rather than something `.env` could turn off.
   */
  it("keeps the demo off the migration step whatever .env says", () => {
    const demo = composeServices("compose.demo.yaml").app;

    expect(demo?.dockerfile).toBe("Dockerfile");
    expect(demo?.environment.DEMO_MODE).toBe('"true"');
  });
});
