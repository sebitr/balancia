import "server-only";
import { inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { telemetryDailyStats, telemetryReports } from "@/lib/db/schema";
import { utcDay } from "./counters";
import { findForbiddenContent } from "./guard";
import {
  TELEMETRY_SCHEMA_VERSION,
  crashReportSchema,
  usageReportSchema,
} from "./schema";

/**
 * The collecting side: what runs at balancia.app.
 *
 * It is the same application in a different role — `TELEMETRY_RECEIVER=true`
 * and nothing else — which is why a fork can point its own installations at
 * its own collector without writing one.
 *
 * The rules it enforces on the way in:
 *
 *  - **Strict schemas.** Unknown properties are rejected, not dropped. A
 *    field nobody agreed to send is a bug at one end or the other, and
 *    accepting it quietly would make the documented list of collected fields
 *    a claim rather than a fact.
 *  - **A known schema version, or a clear refusal.** Version negotiation is
 *    one integer; see docs/telemetry.md for how it evolves.
 *  - **No sender identity.** Nothing about the request is recorded — not the
 *    address, not the headers, not the time to the second. Reports are stored
 *    with the UTC day they arrived and nothing else, and even that exists only
 *    so they can be folded and deleted.
 *  - **Raw payloads are temporary.** They are aggregated into daily counts and
 *    then removed.
 */

/** How long an accepted payload may sit un-aggregated before it is dropped anyway. */
export const RAW_RETENTION_DAYS = 7;

export type IngestOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 400 | 415 | 422;
      readonly error: IngestError;
    };

export type IngestError =
  "invalid-json" | "unknown-schema" | "invalid-payload" | "unsafe-payload";

/**
 * Validates and stores one report.
 *
 * Takes an already-parsed value: reading the body, bounding its size and
 * checking the content type are the route's job, because those are decisions
 * about a request rather than about a report.
 */
export async function ingestReport(
  kind: "usage" | "crash",
  payload: unknown,
  options: { now?: Date } = {},
): Promise<IngestOutcome> {
  const version = schemaVersionOf(payload);
  if (version === null) {
    return { ok: false, status: 400, error: "invalid-payload" };
  }
  if (version !== TELEMETRY_SCHEMA_VERSION) {
    // A newer installation than this collector, or a much older one. Saying so
    // plainly is more useful than a field-by-field validation failure.
    return { ok: false, status: 422, error: "unknown-schema" };
  }

  const schema = kind === "usage" ? usageReportSchema : crashReportSchema;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "invalid-payload" };
  }

  // The same content scan the sender runs, on the way in. A collector should
  // not be the thing that stores an address because some fork's build put one
  // in a field this schema happens to allow.
  if (findForbiddenContent(parsed.data)) {
    return { ok: false, status: 400, error: "unsafe-payload" };
  }

  const now = options.now ?? new Date();
  const db = getDb();
  await db.insert(telemetryReports).values({
    receivedOn: utcDay(now),
    kind,
    schemaVersion: version,
    payload: parsed.data,
  });

  return { ok: true };
}

function schemaVersionOf(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { schema?: unknown }).schema;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Flattens a payload into the (field, value) pairs the aggregate is counted on.
 *
 * `{ last7Days: { ocrUses: "6-10" } }` becomes `last7Days.ocrUses` / `6-10`.
 * Every leaf is already a bucket label, an enum member or a boolean, so the
 * flattening is lossless and the result is still nobody's data.
 */
export function flattenPayload(
  payload: unknown,
  prefix = "",
): Array<[string, string]> {
  if (payload === null || payload === undefined) return [];

  if (typeof payload === "object" && !Array.isArray(payload)) {
    const pairs: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(payload)) {
      const path = prefix ? `${prefix}.${key}` : key;
      pairs.push(...flattenPayload(value, path));
    }
    return pairs;
  }

  if (!prefix) return [];
  return [[prefix, String(payload)]];
}

/**
 * Separates the parts of a grouping key, so a field named `a.b` and a value
 * `c` cannot key the same bucket as a field `a` and a value `b.c`. NUL is
 * chosen because Postgres cannot store one in a `text` column, so no day,
 * kind, field or value read back out of the table can contain it.
 *
 * Written as an escape rather than typed into the literal: a raw NUL byte in
 * the source makes git treat the whole file as binary and print `Bin … bytes`
 * in place of every diff.
 */
const FIELD_SEPARATOR = "\u0000";

export interface AggregationReport {
  readonly folded: number;
  readonly deleted: number;
}

/**
 * Folds every stored report into daily counts and deletes the raw rows.
 *
 * Runs daily. Aggregates are kept indefinitely; there is nothing in one that
 * belongs to anybody, and they are what the project actually reads.
 */
export async function aggregateReceivedReports(
  options: { now?: Date } = {},
): Promise<AggregationReport> {
  const db = getDb();
  const rows = await db
    .select({
      id: telemetryReports.id,
      day: telemetryReports.receivedOn,
      kind: telemetryReports.kind,
      payload: telemetryReports.payload,
    })
    .from(telemetryReports)
    .limit(5_000);

  if (rows.length === 0) {
    return { folded: 0, deleted: await pruneRawReports(options) };
  }

  const counts = new Map<
    string,
    { day: string; kind: "usage" | "crash"; field: string; value: string }
  >();
  const totals = new Map<string, number>();

  for (const row of rows) {
    for (const [field, value] of flattenPayload(row.payload)) {
      const key = [row.day, row.kind, field, value].join(FIELD_SEPARATOR);
      counts.set(key, { day: row.day, kind: row.kind, field, value });
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
  }

  for (const [key, entry] of counts) {
    await db
      .insert(telemetryDailyStats)
      .values({ ...entry, count: totals.get(key) ?? 0 })
      .onConflictDoUpdate({
        target: [
          telemetryDailyStats.day,
          telemetryDailyStats.kind,
          telemetryDailyStats.field,
          telemetryDailyStats.value,
        ],
        set: {
          count: sql`${telemetryDailyStats.count} + ${totals.get(key) ?? 0}`,
        },
      });
  }

  const removed = await db
    .delete(telemetryReports)
    .where(
      inArray(
        telemetryReports.id,
        rows.map((row) => row.id),
      ),
    )
    .returning({ id: telemetryReports.id });

  return { folded: rows.length, deleted: removed.length };
}

/** Drops raw payloads older than the retention window, folded or not. */
export async function pruneRawReports(
  options: { now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = utcDay(
    new Date(now.getTime() - RAW_RETENTION_DAYS * 86_400_000),
  );
  const db = getDb();
  const removed = await db
    .delete(telemetryReports)
    .where(lt(telemetryReports.receivedOn, cutoff))
    .returning({ id: telemetryReports.id });
  return removed.length;
}
