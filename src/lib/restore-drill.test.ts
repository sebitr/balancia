import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The restore drill, held apart from production.
 *
 * docs/backup-and-restore.md used to rehearse a restore with
 * `docker compose -p balancia-drill up` and finish with `… down -v`, on the
 * strength of a sentence saying the project name kept the drill's volumes
 * separate from production's. It did not. compose.yaml names its volumes and
 * containers outright, so a different project changes none of them: on the
 * production host the drill either collided with production's containers or,
 * with production taken down to make room, restored the backup over
 * production's volumes and then deleted them.
 *
 * compose.drill.yaml is the fix, and these tests are what keep it one. They
 * lay it over compose.yaml the way Compose does and check that nothing the two
 * stacks could share — a volume, a container, a published port, an image tag
 * — is shared. Then they read the drill in the docs and check that every
 * command in it carries the file, so that a later edit cannot quietly put the
 * old command back.
 *
 * The files are read as text rather than with a YAML parser, as env.test.ts
 * does: none is a dependency here, and the handful of shapes these files use
 * — a scalar, a block list, a mapping merged from an anchor — is small enough
 * to read line by line without pretending to be general.
 */

interface Service {
  containerName?: string;
  image?: string;
  /** Built on this host, so its `image` is a tag this host writes. */
  built?: boolean;
  /**
   * Absent when the file says nothing about ports. `replace` is the
   * `!override` or `!reset` tag: without one, Compose adds an override's
   * ports to the base's rather than swapping them, and the drill would try to
   * publish production's port as well as its own.
   */
  ports?: { entries: string[]; replace: boolean };
  environment: Record<string, string>;
}

interface ComposeFile {
  name?: string;
  services: Record<string, Service>;
  volumes: Record<string, { name?: string }>;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

/** `${VAR:-default}` as a fresh install sees it: nothing set, defaults taken. */
function interpolate(value: string): string {
  return value.replace(
    /\$\{[A-Z0-9_]+(?::?-([^}]*)|:?\?[^}]*)?\}/g,
    (_, fallback: string | undefined) => fallback ?? "",
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readCompose(file: string): ComposeFile {
  const source = readFileSync(path.join(process.cwd(), file), "utf8");
  const compose: ComposeFile = { services: {}, volumes: {} };
  const anchors: Record<string, Record<string, string>> = {};

  let section = "";
  let anchor: string | undefined;
  let service: Service | undefined;
  let volume: string | undefined;
  let field = "";

  for (const line of source.split("\n")) {
    const content = line.trim();
    if (content === "" || content.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    const merge = /^<<:\s*\*(\S+)$/.exec(content);
    const entry = /^([\w.-]+):(?:\s+(.*))?$/.exec(content);
    const key = entry?.[1] ?? "";
    const rest = entry?.[2] ?? "";

    if (indent === 0 && entry) {
      section = key;
      anchor = /^&(\S+)$/.exec(rest)?.[1];
      if (anchor) anchors[anchor] = {};
      if (key === "name") compose.name = unquote(rest);
    } else if (indent === 2 && entry) {
      if (anchor) anchors[anchor]![key] = unquote(rest);
      if (section === "services") {
        service = compose.services[key] ??= { environment: {} };
      }
      if (section === "volumes") {
        volume = key;
        compose.volumes[key] ??= {};
      }
    } else if (indent === 4 && entry) {
      field = key;
      if (section === "volumes" && volume && key === "name") {
        compose.volumes[volume]!.name = unquote(rest);
      }
      if (section !== "services" || !service) continue;
      if (key === "container_name") service.containerName = unquote(rest);
      if (key === "image") service.image = unquote(rest);
      if (key === "build") service.built = true;
      if (key === "ports") {
        service.ports = {
          entries: [],
          replace: /^!(override|reset)\b/.test(rest),
        };
      }
    } else if (indent === 6 && section === "services" && service) {
      if (field === "ports" && content.startsWith("- ")) {
        service.ports!.entries.push(unquote(content.slice(2)));
      }
      if (field === "environment" && merge) {
        Object.assign(service.environment, anchors[merge[1]]);
      } else if (field === "environment" && entry) {
        service.environment[key] = unquote(rest);
      }
    }
  }

  return compose;
}

/** The second file laid over the first, as `-f first -f second` does. */
function overlay(base: ComposeFile, over: ComposeFile): ComposeFile {
  const services: Record<string, Service> = {};
  for (const key of new Set([
    ...Object.keys(base.services),
    ...Object.keys(over.services),
  ])) {
    const below = base.services[key] ?? { environment: {} };
    const above = over.services[key] ?? { environment: {} };
    const ports = above.ports?.replace
      ? above.ports
      : {
          entries: [
            ...(below.ports?.entries ?? []),
            ...(above.ports?.entries ?? []),
          ],
          replace: false,
        };
    services[key] = {
      containerName: above.containerName ?? below.containerName,
      image: above.image ?? below.image,
      built: above.built ?? below.built,
      ports,
      environment: { ...below.environment, ...above.environment },
    };
  }

  const volumes: Record<string, { name?: string }> = {};
  for (const key of new Set([
    ...Object.keys(base.volumes),
    ...Object.keys(over.volumes),
  ])) {
    volumes[key] = { ...base.volumes[key], ...over.volumes[key] };
  }

  return { name: over.name ?? base.name, services, volumes };
}

/** What Compose calls each container: its `container_name`, or a derived one. */
function containerNames(compose: ComposeFile): Map<string, string> {
  return new Map(
    Object.entries(compose.services).map(([key, service]) => [
      key,
      service.containerName ?? `${compose.name}-${key}-1`,
    ]),
  );
}

/** The same for volumes: an explicit `name`, or one derived from the project. */
function volumeNames(compose: ComposeFile): Map<string, string> {
  return new Map(
    Object.entries(compose.volumes).map(([key, volume]) => [
      key,
      volume.name ?? `${compose.name}_${key}`,
    ]),
  );
}

/**
 * Each published port as `address:port` on the host, `*` for every
 * interface. `5432` alone publishes nothing fixed and is left out.
 */
function publishedPorts(compose: ComposeFile): string[] {
  return Object.values(compose.services).flatMap((service) =>
    (service.ports?.entries ?? []).flatMap((spec) => {
      const parts = interpolate(spec)
        .replace(/\/\w+$/, "")
        .split(":");
      if (parts.length < 2) return [];
      const port = parts[parts.length - 2]!;
      const address = parts.length > 2 ? parts.slice(0, -2).join(":") : "*";
      return [`${address}:${port}`];
    }),
  );
}

/** The tags this host writes when it builds, which a second build overwrites. */
function builtImages(compose: ComposeFile): string[] {
  return Object.values(compose.services).flatMap((service) =>
    service.built && service.image ? [service.image] : [],
  );
}

const PRODUCTION = readCompose("compose.yaml");
const DRILL_FILE = readCompose("compose.drill.yaml");
const DRILL = overlay(PRODUCTION, DRILL_FILE);

describe("compose.drill.yaml over compose.yaml", () => {
  it("names a project of its own", () => {
    expect(PRODUCTION.name).toBe("balancia");
    expect(DRILL.name).toBe("balancia-drill");
  });

  /**
   * The finding itself. A volume the drill shares with production is one its
   * restore writes over and its `down -v` deletes.
   */
  it("puts every volume under a name production does not use", () => {
    const production = volumeNames(PRODUCTION);
    const drill = volumeNames(DRILL);
    const taken = new Set(production.values());

    const shared = [...drill].filter(([, name]) => taken.has(name));

    expect(
      shared.map(([key, name]) => `${key}: ${name}`),
      "these drill volumes are production's own — give each a name under " +
        "volumes: in compose.drill.yaml",
    ).toEqual([]);
    expect([...drill.keys()]).toEqual([...production.keys()]);
  });

  it("gives every container a name production does not use", () => {
    const taken = new Set(containerNames(PRODUCTION).values());

    const shared = [...containerNames(DRILL)].filter(([, name]) =>
      taken.has(name),
    );

    expect(
      shared.map(([key, name]) => `${key}: ${name}`),
      "these drill services would collide with production's containers — " +
        "give each a container_name in compose.drill.yaml",
    ).toEqual([]);
  });

  /**
   * Compared by port number, whatever the address: `127.0.0.1:3000` and
   * `*:3000` cannot both be bound, so a drill on the loopback address is no
   * more separate from a production port on every interface than one on the
   * same address.
   */
  it("publishes nothing on a port production publishes", () => {
    const portOf = (binding: string) => binding.split(":").pop();
    const taken = new Set(publishedPorts(PRODUCTION).map(portOf));
    expect(taken.size).toBeGreaterThan(0);

    const shared = publishedPorts(DRILL).filter((binding) =>
      taken.has(portOf(binding)),
    );

    expect(
      shared,
      "the drill would publish these on production's ports — `ports:` in " +
        "compose.drill.yaml needs `!override`, or a port of its own",
    ).toEqual([]);
  });

  it("publishes only on the loopback address", () => {
    // The drill is a copy of production's data, with production's accounts
    // and their passwords. It is reached from the host or down a tunnel.
    const published = publishedPorts(DRILL);
    expect(published.length).toBeGreaterThan(0);
    expect(
      published.filter((binding) => !binding.startsWith("127.0.0.1:")),
    ).toEqual([]);
  });

  it("builds under an image tag of its own", () => {
    // A shared tag is production's next `up` restarting on the drill's build.
    const taken = new Set(builtImages(PRODUCTION));
    expect(taken.size).toBeGreaterThan(0);

    expect(builtImages(DRILL).filter((image) => taken.has(image))).toEqual([]);
  });

  it("takes none of its names from .env", () => {
    // The drill's .env is a copy of production's — it is part of what is
    // being restored — so an interpolated name or port would resolve to
    // production's value and undo everything above.
    const source = readFileSync(
      path.join(process.cwd(), "compose.drill.yaml"),
      "utf8",
    );
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");

    expect(code).not.toContain("${");
  });

  /**
   * Its own volumes are not enough while it still holds production's
   * credentials. The restored database has real people's addresses and push
   * subscriptions in it and the drill runs the same background jobs, and an
   * instance whose DATABASE_URL or S3 bucket lives outside the stack would
   * otherwise have the drill write to production's copy of either.
   */
  it("keeps the app and the worker off everything production talks to", () => {
    const cutOff = {
      DATABASE_URL: "",
      STORAGE_DRIVER: "local",
      SMTP_HOST: "",
      PUSH_VAPID_PUBLIC_KEY: "",
      PUSH_VAPID_PRIVATE_KEY: "",
    };

    for (const key of ["app", "worker"]) {
      expect(DRILL.services[key]?.environment, key).toMatchObject(cutOff);
    }
  });

  it("tells the app the address it is published on", () => {
    // Otherwise it keeps production's APP_URL, and every sign-in through the
    // drill's own port fails the origin check.
    const app = DRILL.services.app!;
    const [binding] = publishedPorts({ ...DRILL, services: { app } });

    expect(binding).toBeDefined();
    expect(app.environment.APP_URL).toBe(
      `http://localhost:${binding!.split(":").pop()}`,
    );
  });
});

/** The "Testing your backups" section, up to the next heading of its rank. */
function drillSection(): string {
  const source = readFileSync(
    path.join(process.cwd(), "docs", "backup-and-restore.md"),
    "utf8",
  );
  const start = source.indexOf("\n## Testing your backups");
  expect(
    start,
    "docs/backup-and-restore.md should have a “Testing your backups” section",
  ).toBeGreaterThan(-1);

  const end = source.indexOf("\n## ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

/** Every line of the section's code blocks, continuations joined up. */
function drillCommands(): string[] {
  return [...drillSection().matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((block) => block[1]!.replace(/\\\n\s*/g, ""))
    .flatMap((block) => block.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

describe("the drill in docs/backup-and-restore.md", () => {
  const flags = "-f compose.yaml -f compose.drill.yaml -p balancia-drill";

  /**
   * In the drill's checkout a bare `docker compose` is production's project —
   * compose.yaml names it `balancia` wherever it is run — so a command that
   * drops the flags is a command against production, and the last command in
   * the drill is `down -v`.
   */
  it("carries the drill file and project on every compose command", () => {
    const compose = drillCommands().filter((line) =>
      line.includes("docker compose"),
    );
    expect(compose.length).toBeGreaterThan(0);

    expect(
      compose.filter((line) => !line.includes(`docker compose ${flags} `)),
      `every docker compose command in the drill must read \`docker compose ${flags} …\``,
    ).toEqual([]);
  });

  it("brings the drill up and takes it down with that file", () => {
    const commands = drillCommands();

    expect(
      commands.some((line) => line.includes(`docker compose ${flags} up `)),
    ).toBe(true);
    expect(
      commands.some((line) => line.includes(`docker compose ${flags} down -v`)),
    ).toBe(true);
  });

  it("never names production's volumes, containers or image", () => {
    const production = [
      ...volumeNames(PRODUCTION).values(),
      ...containerNames(PRODUCTION).values(),
      ...builtImages(PRODUCTION),
    ];
    const commands = drillCommands().join("\n");

    const named = production.filter((name) =>
      new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`).test(commands),
    );

    expect(
      named,
      "the drill's commands name these, which are production's own",
    ).toEqual([]);
  });
});
