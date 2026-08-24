import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import {
  expensePayers,
  expenseShares,
  expenses,
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
 * of its meaningful content, scoped to the group. On commit, a row whose
 * fingerprint already exists in `imported_fingerprints` is marked
 * `skipped_duplicate` instead of being written again — so importing the same
 * export twice, or resuming a partially failed run, never duplicates money.
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

/** Uploads are capped well below the body limit; exports are text. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export class ImportError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

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
 * These hashes are stored — `imported_fingerprints` is how a retried import
 * knows what it already wrote. Changing anything this function feeds the hash,
 * the separator included, orphans every fingerprint already in the database
 * and lets a re-import write a second copy of somebody's money. The pinned
 * digests in `fingerprint.test.ts` are there to make that impossible to do by
 * accident.
 */
export function fingerprintRow(groupId: string, row: StagedRow): string {
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

  return createHash("sha256").update(canonical).digest("hex");
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
    throw new ImportError("That file is too large to import.");
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

  const fingerprints = parsed.rows.map((entry) =>
    fingerprintRow(access.groupId, entry.row),
  );
  const alreadyImported =
    fingerprints.length > 0
      ? await db
          .select({ fingerprint: importedFingerprints.fingerprint })
          .from(importedFingerprints)
          .where(
            and(
              eq(importedFingerprints.groupId, access.groupId),
              inArray(importedFingerprints.fingerprint, fingerprints),
            ),
          )
      : [];
  const duplicates = new Set(alreadyImported.map((row) => row.fingerprint));

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
        warnings: parsed.warnings,
        rowsTotal: parsed.rows.length,
        createdByUserId:
          access.actor.kind === "user" ? access.actor.userId : null,
      })
      .returning({ id: importRuns.id });

    if (parsed.rows.length > 0) {
      await tx.insert(importRows).values(
        parsed.rows.map((entry, index) => ({
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
      rowsTotal: parsed.rows.length,
      expenseCount: parsed.rows.filter((entry) => entry.row.kind === "expense")
        .length,
      settlementCount: parsed.rows.filter(
        (entry) => entry.row.kind === "settlement",
      ).length,
      duplicateCount: duplicates.size,
      currencies: parsed.currencies,
      sourceParticipants: parsed.participants.map((p) => p.sourceName),
      warnings: parsed.warnings,
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
 * Step 7: record the user's decision about who is who.
 *
 * `mapping` maps a source name either to an existing participant ID or to the
 * sentinel "__create__", which creates a new participant at commit time.
 */
export async function saveParticipantMapping(
  access: GroupAccess,
  importRunId: string,
  mapping: Record<string, string>,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "importData");
  const db = options.db ?? getDb();

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
 * or none do. A row that fails validation is marked `error` and the rest still
 * import — a single bad line should not cost the user the whole file.
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
    // user asked for.
    const existing = await tx
      .select({ id: participants.id, displayName: participants.displayName })
      .from(participants)
      .where(
        and(eq(participants.groupId, groupId), isNull(participants.removedAt)),
      );
    const resolved = new Map<string, string>();
    const byLowerName = new Map(
      existing.map((p) => [p.displayName.trim().toLowerCase(), p.id]),
    );
    let participantsCreated = 0;

    for (const [sourceName, target] of Object.entries(mapping)) {
      if (target === CREATE_PARTICIPANT) {
        const [created] = await tx
          .insert(participants)
          .values({ groupId, displayName: sourceName })
          .returning({ id: participants.id });
        resolved.set(sourceName.trim().toLowerCase(), created.id);
        participantsCreated += 1;
      } else {
        // Only accept IDs that really belong to this group.
        const belongs = existing.some((p) => p.id === target);
        if (!belongs) {
          throw new AuthorizationError(
            "The import maps someone onto a participant from another group.",
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
      if (committed.has(row.fingerprint)) {
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
        const staged = row.staged as StagedRow;
        const entity =
          staged.kind === "expense"
            ? await insertImportedExpense(
                tx,
                groupId,
                staged,
                resolveName,
                mappings,
              )
            : await insertImportedSettlement(tx, groupId, staged, resolveName);

        await tx.insert(importedFingerprints).values({
          groupId,
          fingerprint: row.fingerprint,
          entityType: entity.type,
          entityId: entity.id,
          importRunId,
        });
        committed.add(row.fingerprint);

        await tx
          .update(importRows)
          .set({
            status: "imported",
            createdEntityType: entity.type,
            createdEntityId: entity.id,
            message: null,
          })
          .where(eq(importRows.id, row.id));
        imported += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown import error";
        await tx
          .update(importRows)
          .set({ status: "error", message: message.slice(0, 500) })
          .where(eq(importRows.id, row.id));
        failed += 1;
        logger.warn(
          { importRunId, rowNumber: row.rowNumber, err: message },
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
