import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import { logger } from "@/lib/logger";
import {
  loadMigrations,
  migrationsDirectory,
  splitStatements,
} from "./migrate";
import type { Database } from "./client";
import * as schema from "./schema";

/**
 * The demo instance's database: PostgreSQL compiled to WebAssembly, running
 * inside this process.
 *
 * A demo instance has no `DATABASE_URL` and no PostgreSQL to connect to. It
 * builds the whole schema in memory at startup, from the same committed
 * migrations a real deployment applies, and every visitor's data lives and
 * dies there. Restarting the process is the reset.
 *
 * Real Postgres rather than a hand-written fixture layer is what makes this a
 * small change: the 33 `db.transaction(…)` blocks, the window functions in the
 * balance engine and every one of the ~190 query sites run against it
 * unmodified. What the application sees is a `Database` like any other.
 *
 * The trade-off is that PGlite is a single connection with no pool, so queries
 * serialise. That is fine at demo traffic and stated in docs/demo.md.
 */

/**
 * Held on `globalThis`, for the same reason the connection pool is.
 *
 * Next.js compiles the instrumentation hook and the application into separate
 * module graphs, so this file is instantiated more than once in one process. A
 * plain module-level variable would mean `register()` building a database that
 * `getDb()` then cannot see — which is exactly what happened: every page threw
 * "the demo database has not been bootstrapped" while the startup log said it
 * was ready. It also survives a dev-server hot reload, which would otherwise
 * rebuild the schema and sign every visitor out on each edit.
 */
declare global {
  var __balanciaDemoDb:
    | {
        instance?: Database;
        bootstrapping?: Promise<Database>;
        client?: PGlite;
      }
    | undefined;
}

function state(): NonNullable<typeof globalThis.__balanciaDemoDb> {
  globalThis.__balanciaDemoDb ??= {};
  return globalThis.__balanciaDemoDb;
}

/**
 * Builds the in-memory database and applies every migration.
 *
 * Idempotent, and safe to call concurrently: the second caller awaits the
 * first one's promise rather than building a second database.
 */
export async function bootstrapDemoDatabase(): Promise<Database> {
  const shared = state();
  if (shared.instance) return shared.instance;
  shared.bootstrapping ??= build();
  shared.instance = await shared.bootstrapping;
  return shared.instance;
}

/**
 * The demo database, for the synchronous `getDb()`.
 *
 * Throws rather than building one on demand: `getDb()` cannot await, so a
 * database that is not ready by the first request is a startup bug in
 * `instrumentation.ts`, not something to paper over per request.
 */
export function getDemoDatabase(): Database {
  const { instance } = state();
  if (!instance) {
    throw new Error(
      "The demo database has not been bootstrapped. " +
        "DEMO_MODE is on but `register()` in src/instrumentation.ts did not run.",
    );
  }
  return instance;
}

/** Drops the in-memory database. Used by tests. */
export async function closeDemoDatabase(): Promise<void> {
  const shared = state();
  const client = shared.client;
  globalThis.__balanciaDemoDb = undefined;
  await client?.close();
}

async function build(): Promise<Database> {
  const startedAt = performance.now();

  /*
   * Imported here rather than at the top of the file so that PGlite — a few
   * megabytes of WebAssembly — is pulled in only by an instance that actually
   * runs a demo. `client.ts` imports this module on every deployment, for the
   * one branch in `getDb()`.
   */
  const [{ PGlite, types: pgliteTypes }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);

  const client = new PGlite({
    /*
     * node-postgres hands DATE columns back as strings, and
     * src/lib/db/client.ts keeps it that way on purpose — an expense date is a
     * calendar date, and parsing it into a JS Date silently moves an expense
     * recorded on the 1st to the 31st for anyone west of UTC. PGlite parses
     * dates by default, so the same decision has to be made again here.
     *
     * int8 needs no such treatment: PGlite returns a native bigint and
     * Drizzle's `mode: "bigint"` columns map with `BigInt(value)`, which is
     * exact on one. Money never passes through a JS number either way.
     */
    parsers: { [pgliteTypes.DATE]: (value: string) => value },
  });
  await client.waitReady;
  state().client = client;

  await applyMigrations(client);

  // The query surface Drizzle exposes is identical for both drivers; only the
  // session internals differ, and nothing outside this module touches those.
  // Casting here keeps `Database` a single type, rather than a union that
  // would spread through every `options: { db?: Database }` signature in the
  // codebase.
  const database = drizzle(client, {
    schema,
    casing: "snake_case",
  }) as unknown as Database;

  logger.info(
    { ms: Math.round(performance.now() - startedAt) },
    "Demo database ready (in-memory PostgreSQL; nothing is persisted)",
  );
  return database;
}

/**
 * Applies the committed migrations.
 *
 * The same files and the same `--> statement-breakpoint` splitting as
 * `runMigrations`, minus the advisory lock — there is exactly one process and
 * exactly one connection, so there is nothing to serialise against. The
 * `__balancia_migrations` rows are written all the same, because
 * /api/health/ready reads that table to decide whether this container may be
 * sent traffic.
 */
async function applyMigrations(client: PGlite): Promise<void> {
  const migrations = loadMigrations(migrationsDirectory());
  if (migrations.length === 0) {
    throw new Error(
      `No migrations found in ${migrationsDirectory()}. The demo database ` +
        "builds its schema from the committed SQL, so it cannot start without it.",
    );
  }

  await client.exec(`
    CREATE TABLE IF NOT EXISTS "__balancia_migrations" (
      "name" text PRIMARY KEY,
      "checksum" text NOT NULL,
      "applied_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migration of migrations) {
    await client.exec("BEGIN");
    try {
      for (const statement of splitStatements(migration.sql)) {
        await client.exec(statement);
      }
      await client.query(
        'INSERT INTO "__balancia_migrations" (name, checksum) VALUES ($1, $2)',
        [migration.name, migration.checksum],
      );
      await client.exec("COMMIT");
    } catch (error) {
      await client.exec("ROLLBACK");
      throw new Error(
        `Demo migration ${migration.name} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }
}
