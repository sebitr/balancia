import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { groups, participants } from "./groups";
import { users } from "./auth";
import { expenses } from "./expenses";

export const importSourceFormatEnum = pgEnum("import_source_format", [
  "splitwise_csv",
  "splitwise_json",
  "balancia_json",
]);

export const importRunStatusEnum = pgEnum("import_run_status", [
  "uploaded",
  "parsed",
  "ready",
  "importing",
  "completed",
  "failed",
]);

export const importRowStatusEnum = pgEnum("import_row_status", [
  "pending",
  "imported",
  "skipped_duplicate",
  "warning",
  "error",
]);

export const importRowKindEnum = pgEnum("import_row_kind", [
  "expense",
  "settlement",
  "participant",
]);

/**
 * A staged import.
 *
 * Importing is deliberately a multi-step workflow rather than a single upload
 * handler: parse into staging rows, let the user map people and review
 * warnings, then commit inside one transaction. The file checksum plus
 * per-row fingerprints make a retry safe — rows already imported are detected
 * and skipped instead of duplicated.
 */
export const importRuns = pgTable(
  "import_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    sourceFormat: importSourceFormatEnum("source_format").notNull(),
    status: importRunStatusEnum("status").notNull().default("uploaded"),
    fileName: text("file_name").notNull(),
    fileSize: bigint("file_size", { mode: "bigint" }).notNull(),
    /** SHA-256 of the uploaded file, hex encoded. */
    fileChecksum: text("file_checksum").notNull(),
    /** Detected headers, currencies and other parse-time findings. */
    summary: jsonb("summary"),
    /** Parse/validation warnings that do not block the import. */
    warnings: jsonb("warnings"),
    /** participantName -> participantId decided by the user in the preview step. */
    participantMapping: jsonb("participant_mapping"),
    rowsTotal: integer("rows_total").notNull().default(0),
    rowsImported: integer("rows_imported").notNull().default(0),
    rowsSkipped: integer("rows_skipped").notNull().default(0),
    rowsFailed: integer("rows_failed").notNull().default(0),
    errorMessage: text("error_message"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("import_runs_group_idx").on(table.groupId, table.createdAt.desc()),
    index("import_runs_status_idx").on(table.status),
  ],
);

/**
 * One staged row from the source file.
 *
 * `fingerprint` is a normalized hash of the row's meaningful content (date,
 * description, amount, currency, participants) scoped to the group. It is what
 * lets a second import of the same export recognise "already have this" even
 * when the run is different.
 */
export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRuns.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    kind: importRowKindEnum("kind").notNull(),
    status: importRowStatusEnum("status").notNull().default("pending"),
    /** Normalized staging representation of the row. */
    staged: jsonb("staged").notNull(),
    /** Raw source values, kept so an error message can quote the input. */
    raw: jsonb("raw"),
    fingerprint: text("fingerprint").notNull(),
    message: text("message"),
    createdEntityType: text("created_entity_type"),
    createdEntityId: uuid("created_entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("import_rows_run_idx").on(table.importRunId, table.rowNumber),
    index("import_rows_status_idx").on(table.importRunId, table.status),
    index("import_rows_group_fingerprint_idx").on(
      table.groupId,
      table.fingerprint,
    ),
  ],
);

/**
 * Committed import fingerprints, one row per successfully imported source row.
 * Separate from `import_rows` so retry-safety survives deleting an old run.
 */
export const importedFingerprints = pgTable(
  "imported_fingerprints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    importRunId: uuid("import_run_id").references(() => importRuns.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("imported_fingerprints_group_fingerprint_unique").on(
      table.groupId,
      table.fingerprint,
    ),
  ],
);

/**
 * Receipt attachment metadata. Binary content lives in the storage adapter
 * (local volume or S3) under a random object key; nothing user-controlled ever
 * becomes a path.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    expenseId: uuid("expense_id").references(() => expenses.id, {
      onDelete: "cascade",
    }),
    /** Opaque storage key, generated server-side. */
    storageKey: text("storage_key").notNull(),
    /** Original name, for display and download only — never used as a path. */
    fileName: text("file_name").notNull(),
    /** MIME type detected from file content, not from the client's claim. */
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "bigint" }).notNull(),
    checksum: text("checksum").notNull(),
    uploadedByParticipantId: uuid("uploaded_by_participant_id").references(
      () => participants.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("attachments_storage_key_unique").on(table.storageKey),
    index("attachments_expense_idx").on(table.expenseId),
    index("attachments_group_idx").on(table.groupId),
    // Orphan sweep: uploads never attached to an expense.
    index("attachments_orphan_idx").on(table.createdAt),
  ],
);
