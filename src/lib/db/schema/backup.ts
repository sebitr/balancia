import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Encrypted cloud backup of the groups somebody owns.
 *
 * Three tables, and what each is for matters more than its columns:
 *
 *  - `backup_keys` holds the *public* half of a person's recovery key. The
 *    private half is made in their browser and is never sent here, which is
 *    the whole claim of the feature: a dump of this database cannot open a
 *    backup, and neither can the cloud account the backups are written to.
 *  - `backup_destinations` is a place to write to — a Google Drive, a bucket,
 *    a WebDAV folder — with its credentials sealed and the person's choices
 *    about it: how often, which groups, how many to keep.
 *  - `backup_runs` is what happened, one row per attempt, so that a backup
 *    that has quietly stopped working is something a screen can say.
 *
 * Everything cascades from the account. Deleting an account takes its
 * destinations with it; it deliberately does not reach out to the cloud and
 * delete the files already written there, which belong to the person.
 */

export const backupProviderEnum = pgEnum("backup_provider", [
  "google_drive",
  "dropbox",
  "onedrive",
  "s3",
  "webdav",
  "proton_drive",
  "icloud_drive",
]);

export const backupFrequencyEnum = pgEnum("backup_frequency", [
  "daily",
  "weekly",
]);

/**
 * Whether the scheduler may use a destination.
 *
 * `needs_reconnect` is its own state rather than a failed run because the
 * remedy is different: a revoked token is not fixed by trying again, and
 * trying every hour is how an account ends up flagged by the provider. The
 * scheduler leaves it alone until the person reconnects.
 *
 * `setup` is a destination that exists and is not yet a commitment. Connecting
 * a Google Drive sends the person away and back before they have chosen their
 * groups or how often, and the wizard's draft cannot ride along, so the
 * connection is kept — sealed like any other — and waits here for step 4. The
 * scheduler never sees it, the overview never lists it, and one left behind is
 * deleted after a day.
 */
export const backupDestinationStatusEnum = pgEnum("backup_destination_status", [
  "setup",
  "active",
  "paused",
  "needs_reconnect",
]);

export const backupRunStatusEnum = pgEnum("backup_run_status", [
  "running",
  "succeeded",
  /** Nothing changed since the last backup, so nothing was written. */
  "unchanged",
  "failed",
]);

export const backupTriggerEnum = pgEnum("backup_trigger", [
  "schedule",
  "manual",
]);

export const backupKeys = pgTable("backup_keys", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** An age recipient (`age1…`). Public: the private half never reaches the server. */
  recipient: text("recipient").notNull(),
  /** Eight hex digits naming the key on screen, derived from the recipient. */
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const backupDestinations = pgTable(
  "backup_destinations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: backupProviderEnum("provider").notNull(),
    /** What the person sees: "Google Drive · ada@example.com", "Home Nextcloud". */
    label: text("label").notNull(),
    /**
     * The provider's credentials, sealed with `secret-box` — a refresh token, a
     * secret access key, an app password. Never returned to the browser, never
     * logged. Unreadable after `AUTH_SECRET` is rotated, which reads as "reconnect".
     */
    credentials: text("credentials").notNull(),
    frequency: backupFrequencyEnum("frequency").notNull().default("daily"),
    /** How many backups to keep at the destination; older ones are deleted. */
    keepLast: integer("keep_last").notNull().default(10),
    /** Groups the owner has left out. Everything else they own is backed up, new groups included. */
    excludedGroupIds: uuid("excluded_group_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Off until the owner switches it on, after reading what it costs. */
    includeReceipts: boolean("include_receipts").notNull().default(false),
    status: backupDestinationStatusEnum("status").notNull().default("active"),
    /** The scheduler picks up an active destination once this has passed. */
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    /** Runs that failed since the last good one. Spaces out the retries. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    /**
     * Fingerprint of what the last good backup held, so a night with no change
     * writes nothing instead of one more identical, newly-encrypted file.
     */
    lastContentHash: text("last_content_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("backup_destinations_user_idx").on(table.userId),
    index("backup_destinations_due_idx").on(table.status, table.nextRunAt),
    check(
      "backup_destinations_keep_last_range",
      sql`${table.keepLast} BETWEEN 1 AND 100`,
    ),
  ],
);

export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => backupDestinations.id, { onDelete: "cascade" }),
    trigger: backupTriggerEnum("trigger").notNull(),
    status: backupRunStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    groupCount: integer("group_count").notNull().default(0),
    /** Size of what was written, after encryption. */
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    /** The file written, e.g. `balancia-backup-20261009T033012Z.json.gz.age`. */
    objectName: text("object_name"),
    /** Receipts uploaded by this run. Each is sent once, ever; see `receipts.ts`. */
    receiptsWritten: integer("receipts_written").notNull().default(0),
    /**
     * Receipts still waiting. A run has a budget, so a first backup of a few
     * thousand receipts takes several runs, and a screen can say how many remain.
     */
    receiptsPending: integer("receipts_pending").notNull().default(0),
    /** A stable code from `errors.ts`; the screen turns it into a sentence. */
    errorCode: text("error_code"),
    /** The provider's own words, scrubbed of anything secret and cut short. */
    errorDetail: text("error_detail"),
  },
  (table) => [
    index("backup_runs_destination_idx").on(
      table.destinationId,
      table.startedAt,
    ),
  ],
);
