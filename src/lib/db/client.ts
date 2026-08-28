import "server-only";
import { Pool, types } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getEnv } from "@/lib/env";
import { getDemoDatabase } from "./demo-database";
import {
  databaseQueryDuration,
  poolConnections,
  secondsSince,
} from "@/lib/metrics/metrics";
import * as schema from "./schema";

/**
 * PostgreSQL connection pool and Drizzle client.
 *
 * A single pool is shared per process and cached across Next.js hot reloads,
 * otherwise every edit would leak connections until PostgreSQL refuses new
 * ones.
 */

// node-postgres parses DATE columns into JS Date objects in the server's local
// timezone, which silently shifts an expense recorded on the 1st to the 31st
// for anyone west of UTC. Expense dates are calendar dates, so keep them as
// "YYYY-MM-DD" strings and let the domain decide what they mean.
types.setTypeParser(types.builtins.DATE, (value) => value);

// int8 (bigint) arrives as a string by default, which is correct — money must
// never pass through a JS number. Drizzle's `mode: "bigint"` converts it.

declare global {
  var __balanciaPool: Pool | undefined;
}

export type Database = NodePgDatabase<typeof schema>;

function createPool(): Pool {
  const env = getEnv();
  if (env.DEMO_MODE || !env.DATABASE_URL) {
    // Unreachable through getDb(), which returns the in-memory database before
    // it gets here. Reaching it means something asked for a real connection on
    // an instance that has none — worth a message that says which.
    throw new Error(
      env.DEMO_MODE
        ? "This is a demo instance (DEMO_MODE=true). It has no PostgreSQL connection; " +
            "its data lives in memory. See src/lib/db/demo-database.ts."
        : "DATABASE_URL is not set, so no connection pool can be created.",
    );
  }
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    // Fail fast rather than hanging a request forever on a dead database.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: "balancia",
  });
}

export function getPool(): Pool {
  globalThis.__balanciaPool ??= instrument(createPool());
  return globalThis.__balanciaPool;
}

/**
 * Times every query into the local metrics registry.
 *
 * Wrapped at the pool rather than through Drizzle's logger hook on purpose:
 * the logger hook is handed the SQL *and its parameters*, which for this
 * application means amounts, descriptions and email addresses. This sees a
 * duration and nothing else — there is no label for the statement, so nothing
 * about what was queried can reach a metric.
 */
function instrument(pool: Pool): Pool {
  // Read at scrape time rather than pushed: the pool already knows these, and
  // sampling them on a timer would only add a timer.
  poolConnections().onCollect((gauge) => {
    gauge.set(pool.totalCount, { state: "total" });
    gauge.set(pool.idleCount, { state: "idle" });
    gauge.set(pool.waitingCount, { state: "waiting" });
  });

  const original = pool.query.bind(pool);
  // The overloads on `query` are not expressible here; the wrapper passes its
  // arguments through untouched and returns whatever the driver returned.
  pool.query = ((...args: Parameters<typeof original>) => {
    const startedAt = performance.now();
    const finish = () =>
      databaseQueryDuration().observe(secondsSince(startedAt));
    try {
      const result: unknown = original(...args);
      // `query` returns a promise unless it was given a callback, in which
      // case it returns void and the timing ends here.
      if (result instanceof Promise) {
        return result.finally(finish) as unknown as ReturnType<typeof original>;
      }
      finish();
      return result as ReturnType<typeof original>;
    } catch (error) {
      finish();
      throw error;
    }
  }) as typeof pool.query;
  return pool;
}

let cachedDb: Database | undefined;

export function getDb(): Database {
  /*
   * The whole of demo mode, as far as the rest of the application is
   * concerned. A demo instance answers every query from PostgreSQL-in-WASM
   * held in this process, so the ~190 call sites below this one — and the
   * services, the balance engine and the migrations they depend on — run
   * unchanged and unaware. See src/lib/db/demo-database.ts.
   */
  if (getEnv().DEMO_MODE) {
    return getDemoDatabase();
  }
  cachedDb ??= drizzle(getPool(), { schema, casing: "snake_case" });
  return cachedDb;
}

/**
 * How many rows a statement touched, without asking for the rows.
 *
 * The sweep jobs all want one number — how much did that clear — and the
 * shortest way to get it from Drizzle is `.returning({ id })` and a `.length`,
 * which is what every one of them used to do. That reads every deleted row
 * back over the wire to count it, and the largest sweep is `rate_limits`,
 * whose rows are one per bucket per window: a busy instance accumulates tens
 * of thousands a day and then hauls all of them back to say "42891".
 *
 * The drivers disagree about where the count lives — node-postgres calls it
 * `rowCount`, PGlite (which is the whole database on a demo instance) calls it
 * `affectedRows` — and neither field is declared on Drizzle's shared result
 * type. So it is read defensively here, once, rather than at six call sites.
 */
export function rowsAffected(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const fields = result as {
    rowCount?: unknown;
    affectedRows?: unknown;
  };
  if (typeof fields.rowCount === "number") return fields.rowCount;
  if (typeof fields.affectedRows === "number") return fields.affectedRows;
  return 0;
}

/** Closes the pool. Used by the worker's graceful shutdown and by tests. */
export async function closeDb(): Promise<void> {
  const pool = globalThis.__balanciaPool;
  globalThis.__balanciaPool = undefined;
  cachedDb = undefined;
  if (pool) {
    await pool.end();
  }
}

export { schema };
