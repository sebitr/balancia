import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { Client } from "pg";
import { logger } from "@/lib/logger";

/**
 * Migration runner.
 *
 * Reads the committed SQL files under `drizzle/` and applies the ones that
 * have not run yet, each inside its own transaction, with a PostgreSQL
 * advisory lock so concurrent app/worker containers cannot race.
 *
 * Deliberately not `drizzle-kit push`: production applies reviewed SQL only.
 */

const MIGRATION_LOCK_ID = 4_207_331_101;

export interface MigrationResult {
  readonly applied: string[];
  readonly skipped: string[];
}

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

/** The default location of the committed migrations. */
export function migrationsDirectory(): string {
  return path.join(process.cwd(), "drizzle");
}

export function loadMigrations(directory: string): MigrationFile[] {
  const entries = readdirSync(directory)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
  return entries.map((name) => {
    const sql = readFileSync(path.join(directory, name), "utf8");
    return {
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    };
  });
}

/**
 * Statements are separated by drizzle-kit's `--> statement-breakpoint` marker
 * rather than by naive `;` splitting, which would shred function bodies and
 * string literals containing semicolons.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export async function runMigrations(options: {
  databaseUrl: string;
  migrationsDir?: string;
}): Promise<MigrationResult> {
  const migrationsDir = options.migrationsDir ?? migrationsDirectory();
  const migrations = loadMigrations(migrationsDir);

  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();

  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "__balancia_migrations" (
        "name" text PRIMARY KEY,
        "checksum" text NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Serialize migrations across containers; released on disconnect.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM "__balancia_migrations"',
    );
    const alreadyApplied = new Map(rows.map((row) => [row.name, row.checksum]));

    for (const migration of migrations) {
      const previousChecksum = alreadyApplied.get(migration.name);
      if (previousChecksum) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} has already been applied but its contents changed ` +
              "(checksum mismatch). Applied migrations are immutable — add a new migration instead.",
          );
        }
        skipped.push(migration.name);
        continue;
      }

      await client.query("BEGIN");
      try {
        for (const statement of splitStatements(migration.sql)) {
          await client.query(statement);
        }
        await client.query(
          'INSERT INTO "__balancia_migrations" (name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        applied.push(migration.name);
        logger.info({ migration: migration.name }, "Applied migration");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${migration.name} failed and was rolled back: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
      .catch(() => undefined);
    await client.end();
  }

  return { applied, skipped };
}
