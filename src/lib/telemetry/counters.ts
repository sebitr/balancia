import "server-only";
import { and, gte, lte, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { telemetryCounters } from "@/lib/db/schema";
import {
  COUNTER_KEY_MAX_LENGTH,
  COUNTER_KEY_PATTERN,
  type CounterKey,
} from "./events";

/**
 * The local aggregator: numbers per day, and nothing else.
 *
 * This is the only thing a recorded product event turns into. There is no
 * event table, no row per action, no timestamp finer than a calendar day and
 * no column that could hold a reference to a group, a person or an expense —
 * so "what did user X do" is not a query that can be written against this
 * schema, by us or by anyone who takes a copy of the database.
 *
 * Days are UTC. The report speaks in weeks, and a fixed reference point means
 * the same seven rows are summed whichever container assembles them.
 */

/** The UTC calendar day of an instant, as PostgreSQL's `date` reads it. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** `days` before `at`, as a UTC day string. */
export function utcDayBefore(at: Date, days: number): string {
  return utcDay(new Date(at.getTime() - days * 86_400_000));
}

/**
 * Keys are assembled from literal types, so a malformed one is a programming
 * error rather than a possibility. Checked anyway, here and again as a check
 * constraint in the schema: this column is the one place where a future bug
 * could turn telemetry into free text, and it is cheap to make that
 * impossible twice.
 */
function isWellFormed(key: CounterKey): boolean {
  return key.length <= COUNTER_KEY_MAX_LENGTH && COUNTER_KEY_PATTERN.test(key);
}

/**
 * Adds one to each of today's counters.
 *
 * Callers are fire-and-forget; failures are the caller's to swallow. Nothing
 * here is transactional with the domain write that caused it, deliberately:
 * an expense must never fail to save because a counter could not be
 * incremented.
 */
export async function incrementCounters(
  keys: readonly CounterKey[],
  options: { now?: Date } = {},
): Promise<void> {
  const day = utcDay(options.now ?? new Date());
  const unique = [...new Set(keys)].filter(isWellFormed);
  if (unique.length === 0) return;

  const db = getDb();
  await db
    .insert(telemetryCounters)
    .values(unique.map((metric) => ({ day, metric, count: 1 })))
    .onConflictDoUpdate({
      target: [telemetryCounters.day, telemetryCounters.metric],
      set: { count: sql`${telemetryCounters.count} + 1` },
    });
}

/**
 * Sums a closed range of days into one map of metric → total.
 *
 * Both ends inclusive; missing days are simply absent, and the report builder
 * treats absence as zero.
 */
export async function readCounters(
  fromDay: string,
  toDay: string,
): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select({
      metric: telemetryCounters.metric,
      total: sql<number>`sum(${telemetryCounters.count})::int`,
    })
    .from(telemetryCounters)
    .where(
      and(
        gte(telemetryCounters.day, fromDay),
        lte(telemetryCounters.day, toDay),
      ),
    )
    .groupBy(telemetryCounters.metric);

  return new Map(rows.map((row) => [row.metric, Number(row.total)]));
}

/**
 * Drops counters older than a day boundary.
 *
 * Called by the maintenance sweep. Nothing needs the history: a report covers
 * one week, and keeping months of counters would only build the fingerprint
 * that bucketing exists to avoid.
 */
export async function pruneCounters(olderThanDay: string): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(telemetryCounters)
    .where(lt(telemetryCounters.day, olderThanDay))
    .returning({ metric: telemetryCounters.metric });
  return deleted.length;
}

/**
 * Deletes every counter.
 *
 * Run when an administrator switches usage reporting off, so that "off" means
 * the data is gone rather than merely unsent. Switching it on again starts
 * from nothing.
 */
export async function clearCounters(): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(telemetryCounters)
    .returning({ metric: telemetryCounters.metric });
  return deleted.length;
}
