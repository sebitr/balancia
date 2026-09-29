import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { logger } from "@/lib/logger";
import { NewerSchemaError, runMigrations } from "./migrate";

/**
 * An older build started against a database a newer one has migrated.
 *
 * The runner only ever iterated its own files, so an image rolled back after
 * an upgrade found every one of them applied, logged "already up to date" and
 * served — old code on a schema it was never written for, with nothing said.
 *
 * Each test gets a scratch database of its own and a directory of throwaway
 * migrations, so that "a newer build" can be written down as a row in
 * `__balancia_migrations` without touching the schema every other integration
 * test runs against.
 */

const baseUrl =
  process.env.BALANCIA_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("The integration global setup should have set DATABASE_URL");
}

const scratchName = `${new URL(baseUrl).pathname.slice(1)}_migrate_ahead`;

function withDatabase(name: string): string {
  const url = new URL(baseUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}

const scratchUrl = withDatabase(scratchName);

async function admin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: withDatabase("postgres") });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function query<T extends Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: scratchUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, values)).rows;
  } finally {
    await client.end();
  }
}

async function tableExists(name: string): Promise<boolean> {
  const [row] = await query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [name],
  );
  return row.exists;
}

let migrationsDir: string;

function migration(name: string, sql: string): void {
  writeFileSync(path.join(migrationsDir, name), sql);
}

/** The newer build: it applied one more migration than this build ships. */
async function upgradedByANewerBuild(): Promise<void> {
  migration("0000_first.sql", "CREATE TABLE first_table (id integer);");
  migration("0001_second.sql", "CREATE TABLE second_table (id integer);");
  await runMigrations({ databaseUrl: scratchUrl, migrationsDir });
  await query(
    'INSERT INTO "__balancia_migrations" (name, checksum) VALUES ($1, $2)',
    ["0002_from_the_future.sql", "0".repeat(64)],
  );
}

beforeEach(async () => {
  migrationsDir = mkdtempSync(path.join(tmpdir(), "balancia-migrations-"));
  await admin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${scratchName}"`);
  });
});

afterEach(() => {
  rmSync(migrationsDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

afterAll(async () => {
  await admin((client) =>
    client.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
  );
});

describe("a database migrated by a newer build", () => {
  it("is refused, naming what this build does not know", async () => {
    await upgradedByANewerBuild();

    const attempt = runMigrations({ databaseUrl: scratchUrl, migrationsDir });

    await expect(attempt).rejects.toBeInstanceOf(NewerSchemaError);
    await expect(attempt).rejects.toThrow(/0002_from_the_future\.sql/);
    await expect(attempt).rejects.toThrow(/ALLOW_NEWER_SCHEMA=true/);
  });

  it("is refused before this build applies anything of its own", async () => {
    await upgradedByANewerBuild();
    // A build whose history diverged: it has a third migration the database
    // does not, as well as missing the one the database has.
    migration("0002_sideways.sql", "CREATE TABLE sideways_table (id integer);");

    await expect(
      runMigrations({ databaseUrl: scratchUrl, migrationsDir }),
    ).rejects.toBeInstanceOf(NewerSchemaError);

    expect(await tableExists("sideways_table")).toBe(false);
  });

  it("starts, and says so, when the operator has allowed it", async () => {
    await upgradedByANewerBuild();
    migration("0002_sideways.sql", "CREATE TABLE sideways_table (id integer);");
    const warn = vi.spyOn(logger, "warn");

    const result = await runMigrations({
      databaseUrl: scratchUrl,
      migrationsDir,
      allowNewerSchema: true,
    });

    expect(result.unknown).toEqual(["0002_from_the_future.sql"]);
    expect(result.applied).toEqual(["0002_sideways.sql"]);
    expect(result.skipped).toEqual(["0000_first.sql", "0001_second.sql"]);
    expect(warn).toHaveBeenCalledWith(
      { migrations: ["0002_from_the_future.sql"] },
      expect.stringContaining("newer schema"),
    );
  });

  it("lets go of the migration lock when it refuses", async () => {
    // Refused first, then allowed: had the refusal kept the advisory lock,
    // the second run would wait on it for ever.
    await upgradedByANewerBuild();
    await expect(
      runMigrations({ databaseUrl: scratchUrl, migrationsDir }),
    ).rejects.toBeInstanceOf(NewerSchemaError);

    await expect(
      runMigrations({
        databaseUrl: scratchUrl,
        migrationsDir,
        allowNewerSchema: true,
      }),
    ).resolves.toMatchObject({ unknown: ["0002_from_the_future.sql"] });
  });
});

describe("a database this build knows all of", () => {
  it("says nothing about a newer schema", async () => {
    migration("0000_first.sql", "CREATE TABLE first_table (id integer);");
    await runMigrations({ databaseUrl: scratchUrl, migrationsDir });
    migration("0001_second.sql", "CREATE TABLE second_table (id integer);");
    const warn = vi.spyOn(logger, "warn");

    const result = await runMigrations({
      databaseUrl: scratchUrl,
      migrationsDir,
    });

    expect(result).toEqual({
      applied: ["0001_second.sql"],
      skipped: ["0000_first.sql"],
      unknown: [],
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
