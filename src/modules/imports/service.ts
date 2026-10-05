import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Database } from "@/lib/db/client";
import {
  expensePayers,
  expenseShares,
  expenses,
  groupMembers,
  groups,
  importRows,
  importRuns,
  importedFingerprints,
  participants,
  settlements,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
  AuthorizationError,
  requirePermission,
  type GroupAccess,
} from "@/lib/security/authorization";
import { recordActivity } from "@/modules/activity/service";
import type { LearnedMerchantMapping } from "@/modules/categorization";
import { loadGroupMappings } from "@/modules/categorization/service";
import { DEFAULT_DIRECTION } from "@/modules/expenses/direction";
import { dispatchNotifications } from "@/modules/notifications/service";
import { recordImportNotification } from "@/modules/notifications/events";
import { telemetry } from "@/lib/telemetry";
import { categorizeImportedExpense } from "./categories";
import {
  IMPORT_TEXT_LIMITS,
  MAX_IMPORT_BYTES,
  fitText,
  fitToImportLimits,
} from "./limits";
import { balanciaJsonAdapter } from "./balancia-json";
import { splitwiseCsvAdapter } from "./splitwise-csv";
import { splitwiseJsonAdapter } from "./splitwise-json";
import {
  ImportParseError,
  type ImportAdapter,
  type ImportSourceFormat,
  type ParsedImport,
  type StagedExpense,
  type StagedRow,
  type StagedSettlement,
} from "./types";

/**
 * Staged import.
 *
 * The workflow is deliberately in steps rather than one upload handler:
 *
 *   upload → parse into staging rows → preview (participants, warnings) →
 *   map people → commit in one transaction → report
 *
 * Retry safety comes from fingerprints. Each staged row gets a normalized hash
 * of its meaningful content, scoped to the group, and numbered where the file
 * holds the same line more than once, so a second copy is not taken for the
 * first. On commit, a row whose
 * fingerprint already exists in `imported_fingerprints` is marked
 * `skipped_duplicate` instead of being written again — so importing the same
 * export twice, or resuming a partially failed run, never duplicates money.
 * A line an older importer read differently is also known by the fingerprint
 * it was given then (`formerFingerprint`).
 *
 * Nothing is ever sent anywhere: parsing happens in this process.
 */

// Balancia's own export is tried first: it is the only format identified by an
// envelope rather than by the shape of a row, so the check is both the cheapest
// and the least likely to claim a file that is not its own.
const ADAPTERS: readonly ImportAdapter[] = [
  balanciaJsonAdapter,
  splitwiseCsvAdapter,
  splitwiseJsonAdapter,
];

export class ImportError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
    /** A key under `serverErrors`, where the refusal has been translated. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/**
 * What a row that failed for any reason but an `ImportError` records.
 *
 * Only an `ImportError` is written for a person to read. Anything else is a
 * fault, and the one most likely here is the database refusing an insert —
 * whose message is Drizzle's, carrying the statement and every value bound to
 * it: the row's description, amount and participants. The reason is in the log
 * (without those values; see `lib/error-for-log.ts`), and this stays generic.
 *
 * English, like every other message in `import_rows`, none of which any
 * screen shows yet.
 */
const ROW_NOT_WRITTEN = "This row could not be saved.";

/**
 * The separator between the fields that make up a fingerprint.
 *
 * NUL is the one character that cannot appear in any of them: Postgres refuses
 * it in a `text` column, so no description, name or currency can ever carry
 * one, and two different rows cannot collide by spelling the separator
 * themselves.
 *
 * Written as an escape rather than typed into the string literal. A raw NUL
 * byte in the source makes git treat this whole file as binary — every diff of
 * it becomes `Bin 22979 -> 23683 bytes` instead of reviewable lines.
 */
const FIELD_SEPARATOR = "\u0000";

/**
 * A stable hash of what a row *means*, so the same transaction recognised
 * across two exports produces the same fingerprint. Deliberately excludes the
 * row number and the file it came from.
 *
 * What a row means is not always enough to tell it from the next one. Two
 * coffees at the same price on the same morning, split the same way, read
 * identically, and a file can rightly hold both. `occurrence` says which copy
 * this is — 1 for the first line of its kind, 2 for the next that reads the
 * same, as `fingerprintRows` counts them — and a copy after the first is
 * hashed with its number. Without it the second coffee was taken for the
 * first, already imported, and never written.
 *
 * These hashes are stored — `imported_fingerprints` is how a retried import
 * knows what it already wrote. Changing anything this function feeds the hash,
 * the separator included, orphans every fingerprint already in the database
 * and lets a re-import write a second copy of somebody's money. That is why
 * the first copy is hashed exactly as it was before copies were counted, and
 * why the pinned digests in `fingerprint.test.ts` are there to make changing
 * any of it impossible to do by accident.
 */
export function fingerprintRow(
  groupId: string,
  row: StagedRow,
  occurrence = 1,
): string {
  const canonical =
    row.kind === "expense"
      ? [
          "expense",
          groupId,
          row.date,
          row.description.trim().toLowerCase(),
          row.amount,
          row.currency,
          [...row.payers]
            .map(
              (payer) =>
                `${payer.sourceName.trim().toLowerCase()}:${payer.amount}`,
            )
            .sort()
            .join("|"),
          [...row.shares]
            .map(
              (share) =>
                `${share.sourceName.trim().toLowerCase()}:${share.amount}`,
            )
            .sort()
            .join("|"),
        ].join(FIELD_SEPARATOR)
      : [
          "settlement",
          groupId,
          row.date,
          row.amount,
          row.currency,
          row.fromSourceName.trim().toLowerCase(),
          row.toSourceName.trim().toLowerCase(),
        ].join(FIELD_SEPARATOR);

  // A copy's number goes on as one more field. Each kind of row has a fixed
  // number of fields, its kind first, so the extra one cannot make a copy
  // read as the first of some other row.
  const counted =
    occurrence === 1
      ? canonical
      : [canonical, String(occurrence)].join(FIELD_SEPARATOR);

  return createHash("sha256").update(counted).digest("hex");
}

/**
 * The fingerprint an earlier importer gave the same line, when it read the
 * line as something else — null otherwise. See `formerlyReadAs`.
 *
 * A row is already imported if the group holds either this or its own
 * fingerprint. Nothing is ever stored under this one: it names what an older
 * import wrote, so that a newer reading of the same file does not write it
 * again.
 *
 * Taken with the row's own `occurrence`: the second of two identical "Bob
 * paid Carol" lines was the second of the two expenses an older import read
 * them as. That import wrote only the first — it took the second for the
 * first — so nothing holds the second's former fingerprint, and the line
 * comes in now, which is what the group was missing.
 */
export function formerFingerprint(
  groupId: string,
  row: StagedRow,
  occurrence = 1,
): string | null {
  return row.kind === "settlement" && row.formerlyReadAs
    ? fingerprintRow(groupId, row.formerlyReadAs, occurrence)
    : null;
}

export interface RowFingerprints {
  /** What the row is stored under once it is imported. */
  readonly fingerprint: string;
  /** See `formerFingerprint`. */
  readonly former: string | null;
}

/**
 * Both fingerprints of every row of one file, in the file's order.
 *
 * A row is counted only against the rows before it that read exactly the same,
 * so the second of two identical coffees is the second whatever else the file
 * holds, and a later export that adds other lines — before them, or between
 * them — leaves both where they were. Which of two identical lines comes first
 * cannot matter either: either way round, the file holds the same pair.
 */
export function fingerprintRows(
  groupId: string,
  rows: readonly StagedRow[],
): RowFingerprints[] {
  const copies = new Map<string, number>();
  return rows.map((row) => {
    const first = fingerprintRow(groupId, row);
    const occurrence = (copies.get(first) ?? 0) + 1;
    copies.set(first, occurrence);
    return {
      fingerprint:
        occurrence === 1 ? first : fingerprintRow(groupId, row, occurrence),
      former: formerFingerprint(groupId, row, occurrence),
    };
  });
}

export interface ImportPreview {
  readonly importRunId: string;
  readonly format: ParsedImport["format"];
  readonly fileName: string;
  readonly rowsTotal: number;
  readonly expenseCount: number;
  readonly settlementCount: number;
  readonly duplicateCount: number;
  readonly currencies: readonly string[];
  readonly sourceParticipants: readonly string[];
  readonly warnings: ParsedImport["warnings"];
  readonly detected: Record<string, unknown>;
  /** Existing participants the user can map source names onto. */
  readonly groupParticipants: readonly { id: string; displayName: string }[];
  /** Best-guess mapping by exact (case-insensitive) name match. */
  readonly suggestedMapping: Readonly<Record<string, string>>;
}

function pickAdapter(content: string, fileName: string): ImportAdapter {
  const adapter = ADAPTERS.find((candidate) =>
    candidate.detect(content, fileName),
  );
  if (!adapter) {
    throw new ImportError(
      "That file was not recognised.",
      "Balancia accepts its own JSON export, a Splitwise group CSV export (.csv), or a Splitwise JSON backup (.json).",
    );
  }
  return adapter;
}

/**
 * Step 1–3: parse the upload into staging rows and return a preview.
 * Nothing financial is written yet.
 */
export async function stageImport(
  access: GroupAccess,
  file: { name: string; bytes: Buffer },
  options: { db?: Database } = {},
): Promise<ImportPreview> {
  requirePermission(access, "importData");
  const db = options.db ?? getDb();

  if (file.bytes.byteLength === 0) {
    throw new ImportError("That file is empty.");
  }
  if (file.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportError(
      `That file is larger than ${MAX_IMPORT_BYTES / 1_000_000} MB, the most one import can read.`,
    );
  }

  const content = file.bytes.toString("utf8");
  const adapter = pickAdapter(content, file.name);

  let parsed: ParsedImport;
  try {
    parsed = adapter.parse(content);
  } catch (error) {
    if (error instanceof ImportParseError) {
      throw new ImportError(error.message, error.detail);
    }
    throw error;
  }

  // What the database or the forms would refuse is dropped or shortened here,
  // where the preview can say so, rather than at commit.
  const fitted = fitToImportLimits(parsed);
  const warnings = [...parsed.warnings, ...fitted.warnings];

  const checksum = createHash("sha256").update(file.bytes).digest("hex");

  const existingParticipants = await db
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(
      and(
        eq(participants.groupId, access.groupId),
        isNull(participants.removedAt),
      ),
    )
    .orderBy(asc(participants.createdAt));

  const byLowerName = new Map(
    existingParticipants.map((participant) => [
      participant.displayName.trim().toLowerCase(),
      participant.id,
    ]),
  );
  const suggestedMapping: Record<string, string> = {};
  for (const sourceParticipant of parsed.participants) {
    const match = byLowerName.get(
      sourceParticipant.sourceName.trim().toLowerCase(),
    );
    if (match) {
      suggestedMapping[sourceParticipant.sourceName] = match;
    }
  }

  // Taken from the row as the file had it, not as it is staged: see
  // `FittedRow.source`. Both lists follow the fitted rows, which leave out a
  // row the parsed ones still hold if its amount is too large to record.
  const fingerprinted = fingerprintRows(
    access.groupId,
    fitted.rows.map((entry) => entry.source),
  );
  const fingerprints = fingerprinted.map((entry) => entry.fingerprint);
  const formerFingerprints = fingerprinted.map((entry) => entry.former);
  const lookedUp = [
    ...fingerprints,
    ...formerFingerprints.filter((value): value is string => value !== null),
  ];
  const alreadyImported =
    lookedUp.length > 0
      ? await db
          .select({ fingerprint: importedFingerprints.fingerprint })
          .from(importedFingerprints)
          .where(
            and(
              eq(importedFingerprints.groupId, access.groupId),
              inArray(importedFingerprints.fingerprint, lookedUp),
            ),
          )
      : [];
  const found = new Set(alreadyImported.map((row) => row.fingerprint));
  // Keyed by each row's own fingerprint, whichever of its two was found.
  const duplicates = new Set(
    fingerprints.filter((fingerprint, index) => {
      const former = formerFingerprints[index];
      return found.has(fingerprint) || (former !== null && found.has(former));
    }),
  );

  const preview = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(importRuns)
      .values({
        groupId: access.groupId,
        sourceFormat: parsed.format,
        status: "ready",
        fileName: file.name.slice(0, 200),
        fileSize: BigInt(file.bytes.byteLength),
        fileChecksum: checksum,
        summary: {
          ...parsed.detected,
          currencies: parsed.currencies,
          participants: parsed.participants.map((p) => p.sourceName),
        },
        warnings,
        rowsTotal: fitted.rows.length,
        createdByUserId:
          access.actor.kind === "user" ? access.actor.userId : null,
      })
      .returning({ id: importRuns.id });

    if (fitted.rows.length > 0) {
      await tx.insert(importRows).values(
        fitted.rows.map((entry, index) => ({
          importRunId: run.id,
          groupId: access.groupId,
          rowNumber: entry.rowNumber,
          kind: entry.row.kind,
          status: duplicates.has(fingerprints[index])
            ? ("skipped_duplicate" as const)
            : ("pending" as const),
          staged: entry.row,
          fingerprint: fingerprints[index],
          message: duplicates.has(fingerprints[index])
            ? "Already imported into this group"
            : null,
        })),
      );
    }

    return {
      importRunId: run.id,
      format: parsed.format,
      fileName: file.name,
      rowsTotal: fitted.rows.length,
      expenseCount: fitted.rows.filter((entry) => entry.row.kind === "expense")
        .length,
      settlementCount: fitted.rows.filter(
        (entry) => entry.row.kind === "settlement",
      ).length,
      duplicateCount: duplicates.size,
      currencies: parsed.currencies,
      sourceParticipants: parsed.participants.map((p) => p.sourceName),
      warnings,
      detected: parsed.detected,
      groupParticipants: existingParticipants,
      suggestedMapping,
    };
  });

  // Which of the two Splitwise exports somebody uploaded. Not the file name,
  // not its size, not how many rows it had, and nothing whatsoever from inside
  // it — the participant names in a Splitwise export are the reason this event
  // carries one enum and nothing else. A Balancia backup is not a Splitwise
  // import and is not counted as one; restoring your own file says nothing
  // about people leaving another app.
  if (parsed.format !== "balancia_json") {
    await telemetry.splitwiseImportStarted({
      format: parsed.format === "splitwise_json" ? "json" : "csv",
    });
  }

  return preview;
}

/**
 * The refusal for a participant mapping that does not belong to its run —
 * a name the file never staged, a value that is no participant ID, or a
 * request the commit action could not read as a mapping at all.
 */
export function mappingMismatch(): ImportError {
  return new ImportError(
    "That matching does not fit the file that was read. Read the file again.",
    undefined,
    "importMappingInvalid",
  );
}

/**
 * Step 7: record the user's decision about who is who.
 *
 * `mapping` maps a source name either to an existing participant ID or to the
 * sentinel "__create__", which creates a new participant at commit time.
 *
 * The mapping arrives from the browser, and the commit acts on it without
 * asking again — every `__create__` becomes a person in this group. So it is
 * held to the run it answers before it is stored: each name must be one the
 * file actually staged, and each ID a current participant of this group.
 * Anything else is refused whole, and nothing is written.
 */
export async function saveParticipantMapping(
  access: GroupAccess,
  importRunId: string,
  mapping: Record<string, string>,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "importData");
  const db = options.db ?? getDb();

  const [run] = await db
    .select({ summary: importRuns.summary })
    .from(importRuns)
    .where(
      and(
        eq(importRuns.id, importRunId),
        eq(importRuns.groupId, access.groupId),
      ),
    )
    .limit(1);
  if (!run) {
    throw new AuthorizationError(
      "That import is not part of this group.",
      "notInGroup",
    );
  }

  const stagedNames = (run.summary as { participants?: unknown } | null)
    ?.participants;
  const known = new Set(
    Array.isArray(stagedNames)
      ? stagedNames.filter((name): name is string => typeof name === "string")
      : [],
  );
  const targets = [
    ...new Set(
      Object.values(mapping).filter((target) => target !== CREATE_PARTICIPANT),
    ),
  ];
  if (
    Object.keys(mapping).some((name) => !known.has(name)) ||
    targets.some((target) => !z.uuid().safeParse(target).success)
  ) {
    throw mappingMismatch();
  }
  if (targets.length > 0) {
    const found = await db
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(
          eq(participants.groupId, access.groupId),
          isNull(participants.removedAt),
          inArray(participants.id, targets),
        ),
      );
    if (found.length !== targets.length) {
      throw new ImportError(
        "Somebody you matched is not in this group any more. Read the file again and match the people afresh.",
        undefined,
        "importParticipantUnknown",
      );
    }
  }

  const updated = await db
    .update(importRuns)
    .set({ participantMapping: mapping })
    .where(
      and(
        eq(importRuns.id, importRunId),
        eq(importRuns.groupId, access.groupId),
      ),
    )
    .returning({ id: importRuns.id });

  if (updated.length === 0) {
    throw new AuthorizationError(
      "That import is not part of this group.",
      "notInGroup",
    );
  }
}

export const CREATE_PARTICIPANT = "__create__";

export interface ImportReport {
  readonly importRunId: string;
  readonly imported: number;
  readonly skipped: number;
  readonly failed: number;
  readonly participantsCreated: number;
}

/**
 * Step 8: commit the staged rows.
 *
 * Everything happens in one transaction: participants created by the mapping,
 * expenses, settlements, fingerprints and the activity event either all land
 * or none do. A row that fails is marked `error` and the rest still import — a
 * single bad line should not cost the user the whole file.
 *
 * That holds for a row the database refuses as much as for one this code
 * refuses, which is why each row runs in a savepoint of its own: without one,
 * PostgreSQL's refusal poisons the whole transaction, and the file that had
 * one bad line fails on every retry.
 */
export async function commitImportRun(
  importRunId: string,
  groupId: string,
  options: { db?: Database } = {},
): Promise<ImportReport> {
  const db = options.db ?? getDb();

  const [run] = await db
    .select({
      id: importRuns.id,
      groupId: importRuns.groupId,
      status: importRuns.status,
      participantMapping: importRuns.participantMapping,
      fileName: importRuns.fileName,
      sourceFormat: importRuns.sourceFormat,
      createdByUserId: importRuns.createdByUserId,
    })
    .from(importRuns)
    .where(and(eq(importRuns.id, importRunId), eq(importRuns.groupId, groupId)))
    .limit(1);

  if (!run) {
    throw new AuthorizationError(
      "That import is not part of this group.",
      "notInGroup",
    );
  }
  if (run.status === "completed") {
    // Re-running a finished import is a no-op, not an error: the worker may
    // retry a job whose transaction already committed.
    return {
      importRunId,
      imported: 0,
      skipped: 0,
      failed: 0,
      participantsCreated: 0,
    };
  }

  const mapping = (run.participantMapping ?? {}) as Record<string, string>;

  const { report, notificationIds } = await db.transaction(async (tx) => {
    const [group] = await tx
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (!group) {
      throw new ImportError("The import run disappeared mid-commit.");
    }

    const rows = await tx
      .select({
        id: importRows.id,
        rowNumber: importRows.rowNumber,
        kind: importRows.kind,
        status: importRows.status,
        staged: importRows.staged,
        fingerprint: importRows.fingerprint,
      })
      .from(importRows)
      .where(
        and(
          eq(importRows.importRunId, importRunId),
          eq(importRows.groupId, groupId),
        ),
      )
      .orderBy(asc(importRows.rowNumber));

    // Resolve the source-name → participant-id map, creating participants the
    // user asked for. Held FOR SHARE until the import commits, as every write
    // naming somebody is, so nobody it maps onto can be removed underneath it
    // with a balance it is about to change. See `removeParticipant`.
    const existing = await tx
      .select({ id: participants.id, displayName: participants.displayName })
      .from(participants)
      .where(
        and(eq(participants.groupId, groupId), isNull(participants.removedAt)),
      )
      .for("share");
    const resolved = new Map<string, string>();
    const byLowerName = new Map(
      existing.map((p) => [p.displayName.trim().toLowerCase(), p.id]),
    );
    let participantsCreated = 0;

    for (const [sourceName, target] of Object.entries(mapping)) {
      if (target === CREATE_PARTICIPANT) {
        // The source name stays whole as the key the rows are matched by; the
        // person gets no more of it than the form would let them type.
        const [created] = await tx
          .insert(participants)
          .values({
            groupId,
            displayName: fitText(sourceName, IMPORT_TEXT_LIMITS.displayName),
          })
          .returning({ id: participants.id });
        resolved.set(sourceName.trim().toLowerCase(), created.id);
        participantsCreated += 1;
      } else {
        // Only accept IDs that really belong to this group. Saving the mapping
        // already held it to that, so the reader who gets here — somebody was
        // removed since — is told what the saving step would tell them.
        const belongs = existing.some((p) => p.id === target);
        if (!belongs) {
          throw new AuthorizationError(
            "The import maps someone onto a participant from another group.",
            "importParticipantUnknown",
          );
        }
        resolved.set(sourceName.trim().toLowerCase(), target);
      }
    }

    const resolveName = (sourceName: string): string | null =>
      resolved.get(sourceName.trim().toLowerCase()) ??
      byLowerName.get(sourceName.trim().toLowerCase()) ??
      null;

    // Fingerprints already committed for this group (from a previous attempt).
    const committed = new Set(
      (
        await tx
          .select({ fingerprint: importedFingerprints.fingerprint })
          .from(importedFingerprints)
          .where(eq(importedFingerprints.groupId, groupId))
      ).map((row) => row.fingerprint),
    );

    // Each row's former fingerprint, looked up by the fingerprint the row was
    // staged under so that the two carry the same copy number. The run is
    // counted again from what was staged, in the file's order: the fitted
    // rows rather than the file's, but fitting only shortens text, and a
    // payment — the one kind of row with a former reading — hashes none. A
    // run staged before copies were counted holds every copy under the
    // first's fingerprint, and so gets the first's former fingerprint for
    // each, which is what its preview checked.
    const formerOf = new Map(
      fingerprintRows(
        groupId,
        rows.map((row) => row.staged as StagedRow),
      ).map((entry) => [entry.fingerprint, entry.former]),
    );

    // What this group has already taught the classifier, read once for the
    // whole run: an import of a year's history is one query, not one a row.
    const mappings = await loadGroupMappings(groupId, { db: tx });

    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      if (row.status === "imported") {
        skipped += 1;
        continue;
      }
      const staged = row.staged as StagedRow;
      // The former fingerprint is checked here as well as in the preview,
      // because this is the check that keeps a row out — the preview's answer
      // is stale if another import of the file committed in between.
      const former = formerOf.get(row.fingerprint) ?? null;
      if (
        committed.has(row.fingerprint) ||
        (former !== null && committed.has(former))
      ) {
        await tx
          .update(importRows)
          .set({
            status: "skipped_duplicate",
            message: "Already imported into this group",
          })
          .where(eq(importRows.id, row.id));
        skipped += 1;
        continue;
      }

      try {
        // One savepoint per row. A statement PostgreSQL refuses aborts the
        // transaction it runs in, and every statement after it is refused in
        // turn — including the one below that marks the row as failed. Inside
        // a savepoint the refusal rolls back to the start of this row only,
        // and the outer transaction carries on with the next one.
        await tx.transaction(async (rowTx) => {
          const entity =
            staged.kind === "expense"
              ? await insertImportedExpense(
                  rowTx,
                  groupId,
                  staged,
                  resolveName,
                  mappings,
                )
              : await insertImportedSettlement(
                  rowTx,
                  groupId,
                  staged,
                  resolveName,
                );

          await rowTx.insert(importedFingerprints).values({
            groupId,
            fingerprint: row.fingerprint,
            entityType: entity.type,
            entityId: entity.id,
            importRunId,
          });

          await rowTx
            .update(importRows)
            .set({
              status: "imported",
              createdEntityType: entity.type,
              createdEntityId: entity.id,
              message: null,
            })
            .where(eq(importRows.id, row.id));
        });
        committed.add(row.fingerprint);
        imported += 1;
      } catch (error) {
        // Outside the savepoint, which has already been rolled back: the
        // failure is recorded on the outer transaction, so it survives.
        const message =
          error instanceof ImportError ? error.message : ROW_NOT_WRITTEN;
        await tx
          .update(importRows)
          .set({ status: "error", message: message.slice(0, 500) })
          .where(eq(importRows.id, row.id));
        failed += 1;
        logger.warn(
          { importRunId, rowNumber: row.rowNumber, err: error },
          "Import row failed",
        );
      }
    }

    await tx
      .update(importRuns)
      .set({
        status: "completed",
        rowsImported: imported,
        rowsSkipped: skipped,
        rowsFailed: failed,
        completedAt: new Date(),
      })
      .where(eq(importRuns.id, importRunId));

    await recordActivity(tx, {
      groupId,
      action: "import.completed",
      entityType: "import_run",
      entityId: importRunId,
      actorType: run.createdByUserId ? "user" : "system",
      actorUserId: run.createdByUserId,
      actorLabel: "Import",
      metadata: {
        fileName: run.fileName,
        sourceFormat: run.sourceFormat,
        imported,
        skipped,
        failed,
        participantsCreated,
      },
    });

    // Only the person who started it is waiting on the answer: the import
    // runs in the worker minutes after they left the page. Everyone else
    // learns about it through the expenses it created.
    const notificationIds = run.createdByUserId
      ? await recordImportNotification(tx, {
          groupId,
          groupName: group.name,
          importRunId,
          userId: run.createdByUserId,
          imported,
          skipped,
          failed,
        })
      : [];

    return {
      report: { importRunId, imported, skipped, failed, participantsCreated },
      notificationIds,
    };
  });

  await dispatchNotifications(notificationIds);

  // Whether the run finished with everything in or with rows left behind. Not
  // how many, not what they were, and nothing at all from the Splitwise file.
  // Paired with the started event, so a Balancia restore is absent from both
  // rather than closing a run that was never opened.
  if (run.sourceFormat !== "balancia_json") {
    await telemetry.splitwiseImportCompleted({
      outcome: report.failed === 0 ? "success" : "failure",
    });
  }

  return report;
}

async function insertImportedExpense(
  tx: Database,
  groupId: string,
  staged: StagedExpense,
  resolveName: (name: string) => string | null,
  mappings: readonly LearnedMerchantMapping[] = [],
): Promise<{ type: string; id: string }> {
  const payers = staged.payers.map((payer) => {
    const participantId = resolveName(payer.sourceName);
    if (!participantId) {
      throw new ImportError(`No participant mapped for "${payer.sourceName}"`);
    }
    return { participantId, amount: BigInt(payer.amount) };
  });
  const shares = staged.shares.map((share) => {
    const participantId = resolveName(share.sourceName);
    if (!participantId) {
      throw new ImportError(`No participant mapped for "${share.sourceName}"`);
    }
    return { participantId, amount: BigInt(share.amount) };
  });

  const total = BigInt(staged.amount);
  const paidSum = payers.reduce((sum, payer) => sum + payer.amount, 0n);
  const owedSum = shares.reduce((sum, share) => sum + share.amount, 0n);
  if (paidSum !== total || owedSum !== total) {
    throw new ImportError(
      `Row does not balance: total ${total}, paid ${paidSum}, owed ${owedSum}`,
    );
  }

  const [expense] = await tx
    .insert(expenses)
    .values({
      groupId,
      direction: staged.direction ?? DEFAULT_DIRECTION,
      description: staged.description,
      notes: staged.notes ?? null,
      ...categorizeImportedExpense(staged, { mappings }),
      amount: total,
      currency: staged.currency,
      // Imported rows keep their own currency; a converted group can be
      // reconciled afterwards, and inventing a historical rate here would be
      // worse than leaving it unset.
      splitMethod: "exact",
      splitInput: {
        method: "exact",
        entries: shares.map((share) => ({
          participantId: share.participantId,
          value: share.amount.toString(),
        })),
      },
      expenseDate: staged.date,
      createdByActorType: "system",
    })
    .returning({ id: expenses.id });

  await tx.insert(expensePayers).values(
    payers.map((payer) => ({
      expenseId: expense.id,
      participantId: payer.participantId,
      amount: payer.amount,
    })),
  );
  await tx.insert(expenseShares).values(
    shares.map((share) => ({
      expenseId: expense.id,
      participantId: share.participantId,
      amount: share.amount,
    })),
  );

  return { type: "expense", id: expense.id };
}

async function insertImportedSettlement(
  tx: Database,
  groupId: string,
  staged: StagedSettlement,
  resolveName: (name: string) => string | null,
): Promise<{ type: string; id: string }> {
  const fromParticipantId = resolveName(staged.fromSourceName);
  const toParticipantId = resolveName(staged.toSourceName);
  if (!fromParticipantId || !toParticipantId) {
    throw new ImportError(
      `No participant mapped for "${!fromParticipantId ? staged.fromSourceName : staged.toSourceName}"`,
    );
  }
  if (fromParticipantId === toParticipantId) {
    throw new ImportError("A payment cannot have the same payer and recipient");
  }

  const [settlement] = await tx
    .insert(settlements)
    .values({
      groupId,
      fromParticipantId,
      toParticipantId,
      amount: BigInt(staged.amount),
      currency: staged.currency,
      settledOn: staged.date,
      notes: staged.notes ?? null,
      createdByActorType: "system",
    })
    .returning({ id: settlements.id });

  return { type: "settlement", id: settlement.id };
}

export interface ImportRunSummary {
  readonly id: string;
  readonly fileName: string;
  readonly sourceFormat: ImportSourceFormat;
  readonly status:
    "uploaded" | "parsed" | "ready" | "importing" | "completed" | "failed";
  readonly rowsTotal: number;
  readonly rowsImported: number;
  readonly rowsSkipped: number;
  readonly rowsFailed: number;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export async function listImportRuns(
  groupId: string,
  options: { db?: Database } = {},
): Promise<ImportRunSummary[]> {
  const db = options.db ?? getDb();
  return db
    .select({
      id: importRuns.id,
      fileName: importRuns.fileName,
      sourceFormat: importRuns.sourceFormat,
      status: importRuns.status,
      rowsTotal: importRuns.rowsTotal,
      rowsImported: importRuns.rowsImported,
      rowsSkipped: importRuns.rowsSkipped,
      rowsFailed: importRuns.rowsFailed,
      createdAt: importRuns.createdAt,
      completedAt: importRuns.completedAt,
    })
    .from(importRuns)
    .where(eq(importRuns.groupId, groupId))
    .orderBy(desc(importRuns.createdAt))
    .limit(20);
}

export interface RecentImportRun extends ImportRunSummary {
  readonly groupId: string;
  readonly groupName: string;
}

/**
 * The last few imports this account started, across every group it is in.
 *
 * The per-group list above answers "what has been imported into *this*
 * group", which is what the group's own import screen asks. The settings
 * screen asks the other question — "did that import I ran last week finish?" —
 * and the person asking it does not remember which group they ran it in.
 *
 * Scoped through `group_members` rather than by `created_by_user_id`: an
 * import belongs to the group it landed in, so somebody who joined afterwards
 * should still see that it happened, and somebody who has left should not.
 */
export async function listRecentImportRunsForUser(
  userId: string,
  options: { db?: Database; limit?: number } = {},
): Promise<RecentImportRun[]> {
  const db = options.db ?? getDb();
  return db
    .select({
      id: importRuns.id,
      fileName: importRuns.fileName,
      sourceFormat: importRuns.sourceFormat,
      status: importRuns.status,
      rowsTotal: importRuns.rowsTotal,
      rowsImported: importRuns.rowsImported,
      rowsSkipped: importRuns.rowsSkipped,
      rowsFailed: importRuns.rowsFailed,
      createdAt: importRuns.createdAt,
      completedAt: importRuns.completedAt,
      groupId: importRuns.groupId,
      groupName: groups.name,
    })
    .from(importRuns)
    .innerJoin(groups, eq(groups.id, importRuns.groupId))
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, importRuns.groupId),
        eq(groupMembers.userId, userId),
      ),
    )
    .orderBy(desc(importRuns.createdAt))
    .limit(options.limit ?? 5);
}
