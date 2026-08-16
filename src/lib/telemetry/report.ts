import "server-only";
import { count, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { groups, users } from "@/lib/db/schema";
import { bucketAge, bucketCount, bucketSize, daysBetween } from "./buckets";
import { readCounters, utcDay, utcDayBefore } from "./counters";
import {
  appVersion,
  architecture,
  databaseKind,
  deploymentKind,
  features,
} from "./environment";
import {
  TELEMETRY_SCHEMA_VERSION,
  usageReportSchema,
  type ReportActivity,
  type UsageReport,
} from "./schema";

/**
 * The serializer.
 *
 * One function builds the weekly report, and both the transmission path and
 * the administrator's preview call it. There is no example payload kept
 * anywhere in this repository for the preview to show instead — a preview that
 * did not come from this code would be a description of what Balancia sends
 * rather than evidence of it, and the point of the preview is that it is
 * evidence.
 *
 * Every number goes through a bucket on the way out. The report is assembled
 * from counters and two `count(*)`s, and the exact values exist only inside
 * this function.
 */

/** Days covered by a report, ending on the day it is built. */
export const REPORT_WINDOW_DAYS = 7;

/** How many days of counters are worth keeping: the window, plus slack for a missed run. */
export const COUNTER_RETENTION_DAYS = 14;

function at(counters: Map<string, number>, key: string): number {
  return counters.get(key) ?? 0;
}

/**
 * How many people an expense was split between, as a distribution.
 *
 * Absent buckets are omitted rather than sent as "0": the shape of the object
 * says the same thing with fewer fields, and an instance that created no
 * expenses sends `{}` instead of ten zeroes.
 */
const PARTICIPANT_BUCKETS = [
  "1",
  "2-5",
  "6-10",
  "11-25",
  "26-50",
  "51-100",
  "100_plus",
] as const;

function participantDistribution(
  counters: Map<string, number>,
): ReportActivity["expenseParticipants"] {
  const entries: [string, ReturnType<typeof bucketCount>][] = [];
  for (const bucket of PARTICIPANT_BUCKETS) {
    const value = at(counters, `expense_created.participants.${bucket}`);
    if (value > 0) entries.push([bucket, bucketCount(value)]);
  }
  return entries.length > 0
    ? (Object.fromEntries(entries) as ReportActivity["expenseParticipants"])
    : undefined;
}

function activityFrom(counters: Map<string, number>): ReportActivity {
  return {
    groupsCreated: bucketCount(at(counters, "group_created")),
    expensesCreated: bucketCount(at(counters, "expense_created")),
    expensesUpdated: bucketCount(at(counters, "expense_updated")),
    settlementsCreated: bucketCount(at(counters, "settlement_created")),
    recurringExpensesCreated: bucketCount(
      at(counters, "recurring_expense_created"),
    ),
    multiCurrencyExpenses: bucketCount(
      at(counters, "expense_created.multi_currency"),
    ),
    expensesWithReceipt: bucketCount(
      at(counters, "expense_created.with_receipt"),
    ),
    receiptsAttached: bucketCount(at(counters, "receipt_attached")),
    ocrUses: bucketCount(at(counters, "receipt_ocr_used")),
    splitwiseImportsStarted: bucketCount(
      at(counters, "splitwise_import_started"),
    ),
    splitwiseImportsCompleted: bucketCount(
      at(counters, "splitwise_import_completed"),
    ),
    passkeysRegistered: bucketCount(at(counters, "passkey_registered")),
    invitesCreated: bucketCount(at(counters, "invite_created")),
    guestsJoined: bucketCount(at(counters, "guest_joined")),
    splitMethods: {
      equal: bucketCount(at(counters, "expense_created.split.equal")),
      exact: bucketCount(at(counters, "expense_created.split.exact")),
      percentage: bucketCount(at(counters, "expense_created.split.percentage")),
      shares: bucketCount(at(counters, "expense_created.split.shares")),
    },
    expenseParticipants: participantDistribution(counters),
  };
}

/**
 * When this installation first applied a migration.
 *
 * Used for one coarse age bucket, and read from the migration ledger rather
 * than stored, so that nothing new has to be written down to know it — and so
 * that it cannot become an installation identifier by being unique to the
 * millisecond. Age is reported as one of six ranges.
 */
async function installedAt(): Promise<Date | null> {
  const db = getDb();
  const result = await db.execute(
    sql`SELECT min(applied_at) AS installed_at FROM "__balancia_migrations"`,
  );
  const value = (result.rows[0] as { installed_at?: unknown } | undefined)
    ?.installed_at;
  return value instanceof Date ? value : null;
}

export interface ReportWindow {
  readonly from: string;
  readonly to: string;
}

/** The seven UTC days a report built now would cover. */
export function reportWindow(now: Date): ReportWindow {
  return { from: utcDayBefore(now, REPORT_WINDOW_DAYS - 1), to: utcDay(now) };
}

/**
 * Builds the report this instance would send today.
 *
 * Validates against the wire schema before returning, so a preview cannot show
 * something the transport would refuse to send, and a mistake in this function
 * fails here rather than at the far end.
 */
export async function buildUsageReport(
  options: { now?: Date } = {},
): Promise<UsageReport> {
  const now = options.now ?? new Date();
  const window = reportWindow(now);
  const db = getDb();

  const [counters, [userRow], [groupRow], installed] = await Promise.all([
    readCounters(window.from, window.to),
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(groups),
    installedAt(),
  ]);

  const report: UsageReport = {
    schema: TELEMETRY_SCHEMA_VERSION,
    version: appVersion(),
    deployment: deploymentKind(),
    database: databaseKind(),
    architecture: architecture(),
    instanceAge: bucketAge(installed ? daysBetween(installed, now) : 0),
    users: bucketSize(userRow?.value ?? 0),
    groups: bucketSize(groupRow?.value ?? 0),
    features: features(),
    last7Days: activityFrom(counters),
  };

  // Parse rather than trust: the schema is the contract, and this is the last
  // place it can be checked against a real payload before anything leaves.
  return usageReportSchema.parse(report);
}
