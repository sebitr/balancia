import "server-only";
import { getPool } from "./client";

/**
 * Runs `work` unless somebody is already running work under the same `key`, in
 * which case it does not run and says so at once.
 *
 * A PostgreSQL session advisory lock, taken with `pg_try_advisory_lock`: it is
 * never waited for. Waiting is the obvious way to serialise two callers and the
 * wrong one here, because the caller that holds the lock needs a pool
 * connection of its own to do its work — and if the callers waiting for it have
 * taken the whole pool, it never gets one. Refusing the second caller outright
 * has no such cycle, and for what this guards (two identical changes arriving
 * together) refusal is also the right answer.
 *
 * Held on a connection of its own, taken from the pool and returned to it
 * whether `work` succeeds or throws. If that connection dies the session ends
 * and PostgreSQL drops the lock with it, so a crash cannot leave a key stuck.
 */
export async function withTryLock<T>(
  key: string,
  work: () => Promise<T>,
): Promise<
  { readonly ran: true; readonly value: T } | { readonly ran: false }
> {
  const client = await getPool().connect();
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
        .catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
