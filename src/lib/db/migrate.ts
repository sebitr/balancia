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
  /**
   * Recorded as applied in the database and not among this build's files:
   * what a newer build left behind. Only ever non-empty when
   * `allowNewerSchema` let the run go ahead regardless.
   */
  readonly unknown: string[];
}

/**
 * The database has been migrated by a build this one does not know about.
 *
 * Almost always an image rolled back on its own: the upgrade applied its
 * migrations, something went wrong, and the previous image was started again
 * without the database going back with it. Every migration is forward-only,
 * so the older code now runs against a schema it was never written for — and
 * the failures that causes are not all loud ones. A column it does not know to
 * fill, a table whose rows it does not know to read, is money that is quietly
 * wrong rather than an error in a log.
 */
export class NewerSchemaError extends Error {
  constructor(readonly migrations: readonly string[]) {
    super(
      `The database has ${migrations.length} migration(s) applied that this build does not include: ` +
        `${migrations.join(", ")}. A newer release has upgraded it, and this older one would run ` +
        "against a schema it was never written for. Restore the dump taken before that upgrade " +
        "and start this release again, or go back to the newer image (docs/self-hosting.md, " +
        '"Rolling back"). To run this build against the newer schema anyway, having decided to ' +
        "accept that, set ALLOW_NEWER_SCHEMA=true.",
    );
    this.name = "NewerSchemaError";
  }
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

/**
 * The committed migrations' names, in the order they apply — which is also
 * what `/api/health/ready` compares the database against, so the two can
 * never disagree about what counts as a migration.
 */
export function migrationNames(directory: string): string[] {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
}

export function loadMigrations(directory: string): MigrationFile[] {
  return migrationNames(directory).map((name) => {
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
  /**
   * Go ahead, with a warning, when the database holds migrations this build
   * does not — rather than refusing with a {@link NewerSchemaError}. Off
   * unless the caller says otherwise; `scripts/migrate.ts` decides from
   * `ALLOW_NEWER_SCHEMA` and `NODE_ENV`.
   */
  allowNewerSchema?: boolean;
}): Promise<MigrationResult> {
  const migrationsDir = options.migrationsDir ?? migrationsDirectory();
  const migrations = loadMigrations(migrationsDir);

  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();

  const applied: string[] = [];
  const skipped: string[] = [];
  let unknown: string[] = [];

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

    // The loop below only ever looks at this build's own files, so without
    // this an older image started against a newer database found nothing to
    // do, logged "already up to date" and served. Checked before anything is
    // applied: a build that is refused must not have half-migrated first.
    const bundled = new Set(migrations.map((migration) => migration.name));
    unknown = rows
      .map((row) => row.name)
      .filter((name) => !bundled.has(name))
      .sort();
    if (unknown.length > 0) {
      if (!options.allowNewerSchema) {
        throw new NewerSchemaError(unknown);
      }
      logger.warn(
        { migrations: unknown },
        `Running against a newer schema: the database has ${unknown.length} migration(s) this build does not include`,
      );
    }

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

  return { applied, skipped, unknown };
}
