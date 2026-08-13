import "server-only";
import { Pool, types } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getEnv } from "@/lib/env";
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
  globalThis.__balanciaPool ??= createPool();
  return globalThis.__balanciaPool;
}

let cachedDb: Database | undefined;

export function getDb(): Database {
  cachedDb ??= drizzle(getPool(), { schema, casing: "snake_case" });
  return cachedDb;
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
