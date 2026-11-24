import "server-only";
import { Pool } from "pg";
import { getEnv } from "@/lib/env";

/**
 * Runs `work` unless somebody is already running work under the same `key`, in
 * which case it does not run and says so at once.
 *
 * A PostgreSQL session advisory lock, taken with `pg_try_advisory_lock`: it is
 * never waited for. For what this guards — two identical changes arriving
 * together — refusing the second outright is the right answer anyway.
 *
 * **The lock is held on a connection from a pool of its own, never the main
 * one.** A session lock needs a connection for as long as `work` runs, and
 * `work` needs a connection of its own from the main pool to do anything. Held
 * on the main pool, every caller holding a lock would also be waiting for a
 * second connection, and once there are as many callers as the pool has
 * connections, none of them gets one: every write on the instance stalls until
 * the pool's timeout — and with `DATABASE_POOL_MAX=1`, every write does. A
 * connection from this pool never waits on this pool, so that cycle has no way
 * to close; at worst a caller waits here for a lock connection, while the ones
 * that hold them finish.
 *
 * Returned to its pool whether `work` succeeds or throws. If the unlock itself
 * fails the connection is destroyed rather than returned, since a connection
 * still holding the lock would refuse that key until it closed. If the
 * connection dies, the session ends and PostgreSQL drops the lock with it, so a
 * crash cannot leave a key stuck.
 */
export async function withTryLock<T>(
  key: string,
  work: () => Promise<T>,
): Promise<
  { readonly ran: true; readonly value: T } | { readonly ran: false }
> {
  const client = await lockPool().connect();
  let broken = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [key],
    );
    if (!rows[0]?.locked) return { ran: false };
    try {
      return { ran: true, value: await work() };
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key])
        .catch(() => {
          broken = true;
        });
    }
  } finally {
    client.release(broken);
  }
}

/** Few, because a lock is held only for the length of one write. */
const LOCK_POOL_MAX = 4;

function lockPool(): Pool {
  globalThis.__balanciaLockPool ??= createLockPool();
  return globalThis.__balanciaLockPool;
}

function createLockPool(): Pool {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set, so no lock can be taken.");
  }
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: LOCK_POOL_MAX,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: "balancia-locks",
  });
  // An idle connection that the server drops must not take the process with it.
  pool.on("error", () => undefined);
  return pool;
}

declare global {
  var __balanciaLockPool: Pool | undefined;
}
