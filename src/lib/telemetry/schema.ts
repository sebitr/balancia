import { z } from "zod";
import { AGE_BUCKETS, COUNT_BUCKETS, SIZE_BUCKETS } from "./buckets";

/**
 * The wire contract, in one file.
 *
 * Both ends read this: the sender validates a report before it goes out, and
 * the receiver validates it again on the way in. One definition means the two
 * cannot drift, and it means "what is transmitted" is a thing you can read
 * rather than a thing you have to reconstruct from call sites.
 *
 * Everything is `.strict()`. An unknown property is a rejection, not a
 * silently-dropped field — see docs/telemetry.md for the policy and why the
 * schema number exists to make deliberate change possible.
 */

/** Current payload version. Bump only for a breaking change; see the doc. */
export const TELEMETRY_SCHEMA_VERSION = 1;

/**
 * The largest report the receiver will read, in bytes.
 *
 * A complete report is well under 2 KiB. The limit is not a guess at the
 * payload's size, it is a bound on what a stranger can make the receiver hold
 * in memory before validation has said anything about it.
 */
export const MAX_PAYLOAD_BYTES = 8 * 1024;

const countBucket = z.enum(COUNT_BUCKETS);
const sizeBucket = z.enum(SIZE_BUCKETS);
const ageBucket = z.enum(AGE_BUCKETS);

/**
 * Application version, e.g. "1.8.2" or "1.8.2-rc.1".
 *
 * Constrained rather than free text: a version is the only string in the
 * report that comes from a file rather than from a literal in the source, so
 * it is the only one where a fork could accidentally put something else.
 */
const versionString = z
  .string()
  .max(32)
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]{1,16})?$/, "bad version");

export const DEPLOYMENT_KINDS = [
  "docker-compose",
  "docker",
  "standalone",
  "development",
  "unknown",
] as const;

/** Only PostgreSQL is supported; the field exists so the schema can outlive that. */
export const DATABASE_KINDS = ["postgresql"] as const;

export const ARCHITECTURES = ["amd64", "arm64", "other"] as const;

export const STORAGE_KINDS = ["local", "s3"] as const;

/** Whether background jobs run in their own container or inside the web process. */
export const WORKER_MODES = ["separate", "in-web"] as const;

/**
 * Which optional features are switched on.
 *
 * Booleans about *this software's* configuration — not about the people using
 * it. Nothing here narrows to an individual, and none of it is a secret: every
 * value is already visible to anyone who can open the sign-in page.
 */
export const featuresSchema = z
  .object({
    registrationOpen: z.boolean(),
    email: z.boolean(),
    push: z.boolean(),
    appleSignIn: z.boolean(),
    exchangeRates: z.boolean(),
    receiptScanning: z.boolean(),
    semanticCategorization: z.boolean(),
    storage: z.enum(STORAGE_KINDS),
    worker: z.enum(WORKER_MODES),
  })
  .strict();

/**
 * How many people an expense was split between, as a distribution of buckets.
 *
 * `partialRecord` rather than `record`: a bucket nobody landed in is omitted,
 * so an instance that created no expenses sends `{}` rather than ten zeroes.
 * The keys are still closed — anything but a bucket label is a rejection.
 */
const participantDistribution = z.partialRecord(
  z.enum(["1", "2-5", "6-10", "11-25", "26-50", "51-100", "100_plus"]),
  countBucket,
);

export const activitySchema = z
  .object({
    groupsCreated: countBucket,
    expensesCreated: countBucket,
    expensesUpdated: countBucket,
    settlementsCreated: countBucket,
    recurringExpensesCreated: countBucket,
    multiCurrencyExpenses: countBucket,
    expensesWithReceipt: countBucket,
    receiptsAttached: countBucket,
    ocrUses: countBucket,
    splitwiseImportsStarted: countBucket,
    splitwiseImportsCompleted: countBucket,
    passkeysRegistered: countBucket,
    invitesCreated: countBucket,
    guestsJoined: countBucket,
    splitMethods: z
      .object({
        equal: countBucket,
        exact: countBucket,
        percentage: countBucket,
        shares: countBucket,
      })
      .strict(),
    expenseParticipants: participantDistribution.optional(),
  })
  .strict();

/**
 * The weekly anonymous usage report.
 *
 * Read the whole type: this is the complete list of what an opted-in
 * installation transmits. There is no free-text field, no identifier, no
 * timestamp finer than "this week", and no way to add one without editing this
 * object and the documentation beside it.
 */
export const usageReportSchema = z
  .object({
    schema: z.literal(TELEMETRY_SCHEMA_VERSION),
    version: versionString,
    deployment: z.enum(DEPLOYMENT_KINDS),
    database: z.enum(DATABASE_KINDS),
    architecture: z.enum(ARCHITECTURES),
    instanceAge: ageBucket,
    users: sizeBucket,
    groups: sizeBucket,
    features: featuresSchema,
    last7Days: activitySchema,
  })
  .strict();

export type UsageReport = z.infer<typeof usageReportSchema>;
export type ReportActivity = z.infer<typeof activitySchema>;
export type ReportFeatures = z.infer<typeof featuresSchema>;

/**
 * Where an error came from, coarsely.
 *
 * A closed list written by hand at each call site. Never a module path, never
 * a route with parameters in it, never a file name — those carry identifiers
 * and, in a bundled build, nothing stable enough to group by anyway.
 */
export const CRASH_COMPONENTS = [
  "server-action",
  "route-handler",
  "render",
  "scheduler",
  "job",
  "import",
  "notifications",
  "storage",
  "database",
  "telemetry",
  "unknown",
] as const;

export type CrashComponent = (typeof CRASH_COMPONENTS)[number];

/**
 * An error *class*, not an error.
 *
 * The pattern is the enforcement: an identifier, nothing else. A message, a
 * path, an address or a query cannot satisfy it, so a future change that tried
 * to put one here would fail validation before it could leave the process.
 */
const errorClass = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "not an error class name");

export const crashReportSchema = z
  .object({
    schema: z.literal(TELEMETRY_SCHEMA_VERSION),
    version: versionString,
    error: errorClass,
    component: z.enum(CRASH_COMPONENTS),
    deployment: z.enum(DEPLOYMENT_KINDS),
    database: z.enum(DATABASE_KINDS),
    architecture: z.enum(ARCHITECTURES),
  })
  .strict();

export type CrashReport = z.infer<typeof crashReportSchema>;

export type DeploymentKind = (typeof DEPLOYMENT_KINDS)[number];
export type DatabaseKind = (typeof DATABASE_KINDS)[number];
export type Architecture = (typeof ARCHITECTURES)[number];
