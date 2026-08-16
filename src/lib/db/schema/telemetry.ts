import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Telemetry storage — sending side and receiving side.
 *
 * Three ideas govern the shapes here:
 *
 *  1. **Nothing is per-event.** `telemetry_counters` holds one row per day per
 *     metric, and a row is a number. There is no event log to leak, nothing to
 *     join back to a group, an expense or a person, and no way to reconstruct
 *     who did what — because the identity was never written down in the first
 *     place, not because it is filtered out later.
 *  2. **No installation identifier.** Neither the sender's nor the receiver's
 *     tables have a column for one. See docs/telemetry.md; this is deliberate,
 *     and it costs the project the ability to do retention analytics.
 *  3. **Raw is temporary, aggregate is permanent.** The receiver keeps
 *     accepted payloads only long enough to fold them into daily counts, then
 *     deletes them.
 */

/** How the last attempt to transmit a report ended. */
export const telemetrySendStatusEnum = pgEnum("telemetry_send_status", [
  "sent",
  "failed",
]);

/** What a received payload was. */
export const telemetryReportKindEnum = pgEnum("telemetry_report_kind", [
  "usage",
  "crash",
]);

/**
 * Instance-wide settings, as one row.
 *
 * Balancia has had no such table until now: every setting was either a
 * per-user preference or an environment variable. Telemetry needs a third
 * kind — a decision the administrator makes at runtime, for the whole
 * installation, which must survive a restart and must not require editing a
 * file. The single-row constraint is enforced in the database rather than
 * assumed by the code.
 *
 * Both switches default to false. An installation that never opens this page
 * sends nothing, forever.
 */
export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: integer("id").primaryKey().default(1),

    /** Send a weekly anonymous usage report. Off until an administrator says otherwise. */
    usageReportingEnabled: boolean("usage_reporting_enabled")
      .notNull()
      .default(false),
    /** Send anonymous crash classifications. A separate decision, also off. */
    crashReportingEnabled: boolean("crash_reporting_enabled")
      .notNull()
      .default(false),

    /**
     * When each switch last moved. Kept so the administration page can say
     * "on since …" rather than only "on", and so that a report covering a week
     * that began before the switch was thrown can be recognised as such.
     */
    usageReportingChangedAt: timestamp("usage_reporting_changed_at", {
      withTimezone: true,
    }),
    crashReportingChangedAt: timestamp("crash_reporting_changed_at", {
      withTimezone: true,
    }),

    /** Outcome of the most recent transmission attempt, for the same page. */
    lastReportAttemptAt: timestamp("last_report_attempt_at", {
      withTimezone: true,
    }),
    lastReportStatus: telemetrySendStatusEnum("last_report_status"),
    lastReportSentAt: timestamp("last_report_sent_at", { withTimezone: true }),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("instance_settings_singleton", sql`${table.id} = 1`)],
);

/**
 * Local product counters: one number per metric per UTC day.
 *
 * Written only while usage telemetry is switched on, and read only by the
 * report builder and the administration preview. A metric key is assembled
 * from literal types in `src/lib/telemetry/events.ts` — it can say
 * `expense_created.split.percentage`, and it has no way to say anything about
 * the expense.
 *
 * The day is stored as a calendar date in UTC, which is as fine-grained as
 * anything here ever gets: the report speaks in weeks, and this is the
 * smallest unit that lets a seven-day window be assembled without keeping
 * timestamps.
 */
export const telemetryCounters = pgTable(
  "telemetry_counters",
  {
    day: date("day").notNull(),
    metric: text("metric").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.metric] }),
    index("telemetry_counters_day_idx").on(table.day),
    check("telemetry_counters_count_positive", sql`${table.count} >= 0`),
    // Keys come from a closed vocabulary; the constraint stops a bug in a
    // future mapper from turning this column into free text.
    check(
      "telemetry_counters_metric_shape",
      sql`${table.metric} ~ '^[a-z][a-z0-9_]*(\\.[a-z0-9_-]+){0,2}$' AND length(${table.metric}) <= 64`,
    ),
  ],
);

/**
 * Reports this instance has *received*, when it is running as the collector.
 *
 * Empty on every self-hosted installation: the receiving routes are disabled
 * unless `TELEMETRY_RECEIVER` says otherwise, and nothing writes here when
 * they are off. It exists in the shared schema because the collector is the
 * same application in a different role — which is also what lets a fork run
 * its own.
 *
 * There is no sender column, and there cannot be one: the payload carries no
 * identifier, and the request's source address is never read (see
 * docs/telemetry.md on IP handling). Rows are deleted once folded into
 * `telemetry_daily_stats`.
 */
export const telemetryReports = pgTable(
  "telemetry_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The UTC day used for folding, so retention does not depend on clock skew. */
    receivedOn: date("received_on").notNull(),
    kind: telemetryReportKindEnum("kind").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    /** The validated payload, exactly as the schema in `telemetry/schema.ts` defines it. */
    payload: jsonb("payload").notNull(),
  },
  (table) => [index("telemetry_reports_received_idx").on(table.receivedOn)],
);

/**
 * The permanent form: how many reports said each thing, per day.
 *
 * A fold of the raw payloads into (field, value) counts — `version` /
 * `1.8.2`, `last7Days.ocrUses` / `6-10`. It answers every question the
 * project has any business asking, and it is not personal data by
 * construction: there is nothing in a row that belongs to anyone.
 */
export const telemetryDailyStats = pgTable(
  "telemetry_daily_stats",
  {
    day: date("day").notNull(),
    kind: telemetryReportKindEnum("kind").notNull(),
    /** Dotted path within the payload, e.g. `last7Days.expensesCreated`. */
    field: text("field").notNull(),
    /** The bucket label or enum member at that path. */
    value: text("value").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.kind, table.field, table.value] }),
    index("telemetry_daily_stats_day_idx").on(table.day),
  ],
);
