import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { getDb, type Database } from "@/lib/db/client";
import { attachments, groups } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { getStorage } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { telemetry } from "@/lib/telemetry";
import {
  AuthorizationError,
  requirePermission,
  type GroupAccess,
} from "@/lib/security/authorization";

/**
 * Receipt attachments.
 *
 * Upload rules, all enforced here rather than in the route handler:
 *
 *  - Size is capped by UPLOAD_MAX_BYTES, and what one group keeps in total by
 *    GROUP_STORAGE_MAX_BYTES and GROUP_STORAGE_MAX_FILES.
 *  - The MIME type comes from sniffing the file's magic bytes, not from the
 *    client's Content-Type and not from the extension. A .jpg that is really
 *    an HTML file is rejected.
 *  - Only raster images and PDF are accepted. SVG is refused on purpose: it is
 *    an XML document that can carry script, and no one needs a vector receipt.
 *  - The stored object key is random and server-generated, so nothing
 *    user-controlled reaches the filesystem or bucket path.
 *  - Every download re-checks group authorization.
 *  - A receipt's object leaves storage with its row, whichever way the row
 *    goes: deleted on its own, swept, or cascaded away with its group.
 */

/** Content types Balancia will store. */
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

/**
 * How much one group may keep in storage: 2 GiB, in at most 5,000 files.
 *
 * Not a quota anybody is meant to meet. A receipt photographed on a phone is a
 * megabyte or two once the browser has re-encoded it, so the bytes are a
 * thousand-odd receipts — years of a busy household — and the count bounds
 * the other shape of the same problem, a flood of tiny files. What they stop
 * is the volume filling up through one group: guests may upload, a guest link
 * is a bearer token that can be forwarded, and the per-address rate limit on
 * its own still lets a patient stranger write tens of gigabytes a day.
 *
 * Constants rather than settings, deliberately. A deployment that genuinely
 * needs more is rare enough to change a number here, and a knob would be one
 * more thing every operator has to read about before leaving it alone.
 */
export const GROUP_STORAGE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const GROUP_STORAGE_MAX_FILES = 5_000;

export class UploadRejectedError extends Error {
  /** Translated by the Server Action funnel; see `lib/actions.ts`. */
  readonly params: Readonly<Record<string, string | number>>;

  constructor(
    message: string,
    readonly code:
      | "fileEmpty"
      | "fileTooLarge"
      | "fileType"
      | "groupStorageFull" = "fileEmpty",
    params: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "UploadRejectedError";
    this.params = params;
  }
}

/**
 * The refusal for a file over `maxBytes`, wherever the size was learned — here
 * from the bytes, or in the route from a body that ran past the limit before
 * it was even parsed.
 */
export function fileTooLarge(maxBytes: number): UploadRejectedError {
  const limitMb = Math.floor(maxBytes / (1024 * 1024));
  return new UploadRejectedError(
    `That file is larger than the ${limitMb} MB upload limit.`,
    "fileTooLarge",
    { limit: limitMb },
  );
}

export interface UploadedAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: bigint;
}

function generateStorageKey(groupId: string): string {
  // Group prefix keeps buckets browsable for an operator; the random component
  // is what actually makes the key unguessable.
  const random = randomBytes(24).toString("hex");
  return `receipts/${groupId}/${random}`;
}

/**
 * Cleans a client-supplied name for display and Content-Disposition.
 *
 * The name is never used as a path — the storage key is generated — but it is
 * echoed back in a download header, so directory components, control
 * characters and quotes all have to go.
 */
function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "receipt";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"\\]/g, "").trim();
  return cleaned.slice(0, 200) || "receipt";
}

export async function uploadAttachment(
  access: GroupAccess,
  file: { name: string; bytes: Buffer },
  options: { db?: Database } = {},
): Promise<UploadedAttachment> {
  requirePermission(access, "uploadReceipt");
  const env = getEnv();
  const db = options.db ?? getDb();

  if (file.bytes.byteLength === 0) {
    throw new UploadRejectedError("That file is empty.", "fileEmpty");
  }
  if (file.bytes.byteLength > env.UPLOAD_MAX_BYTES) {
    throw fileTooLarge(env.UPLOAD_MAX_BYTES);
  }

  const detected = await fileTypeFromBuffer(file.bytes);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new UploadRejectedError(
      "Receipts must be a JPEG, PNG, WebP, GIF, HEIC image or a PDF.",
      "fileType",
    );
  }

  const storage = getStorage();
  const key = generateStorageKey(access.groupId);
  const stored = await storage.put(key, file.bytes, detected.mime);

  try {
    const record = await db.transaction(async (tx) => {
      // One upload at a time per group, so two arriving together cannot both
      // read the total from before the other and both squeeze under the
      // ceiling. `no key update` rather than `update`, which would also hold
      // up every expense being written into the group: the foreign key check
      // on an insert takes a key-share lock, and this does not conflict with
      // it.
      await tx
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.id, access.groupId))
        .for("no key update");

      // Unlinked uploads count: until the sweeper takes them they occupy the
      // volume like any other, and they are the cheapest way to fill it.
      const [held] = await tx
        .select({
          bytes: sql<string>`coalesce(sum(${attachments.byteSize}), 0)`,
          files: sql<number>`count(*)::int`,
        })
        .from(attachments)
        .where(
          and(
            eq(attachments.groupId, access.groupId),
            isNull(attachments.deletedAt),
          ),
        );
      if (
        BigInt(held?.bytes ?? 0) + BigInt(stored.byteSize) >
          BigInt(GROUP_STORAGE_MAX_BYTES) ||
        (held?.files ?? 0) + 1 > GROUP_STORAGE_MAX_FILES
      ) {
        throw new UploadRejectedError(
          "This group has run out of room for receipts, so this one was not kept.",
          "groupStorageFull",
        );
      }

      const [inserted] = await tx
        .insert(attachments)
        .values({
          groupId: access.groupId,
          storageKey: stored.key,
          fileName: sanitizeFileName(file.name),
          contentType: detected.mime,
          byteSize: BigInt(stored.byteSize),
          checksum: stored.checksum,
          uploadedByParticipantId: access.participantId,
        })
        .returning({
          id: attachments.id,
          fileName: attachments.fileName,
          contentType: attachments.contentType,
          byteSize: attachments.byteSize,
        });
      return inserted;
    });

    // Whether a receipt was a picture or a document, and nothing else. Not the
    // file name — which is often a merchant and a date — not the size, not the
    // checksum, and obviously not the file.
    await telemetry.receiptAttached({
      kind: detected.mime === "application/pdf" ? "pdf" : "image",
    });

    return record;
  } catch (error) {
    // The row is the source of truth. If it fails — or the group had no room
    // for it — the blob is unreferenced garbage: remove it now rather than
    // leaving the volume to grow.
    await storage.delete(stored.key).catch(() => undefined);
    throw error;
  }
}

export interface AttachmentDownload {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}

/**
 * Fetches an attachment for download. The lookup is scoped by the authorized
 * group, so an attachment ID from another group simply does not resolve.
 */
export async function downloadAttachment(
  access: GroupAccess,
  attachmentId: string,
  options: { db?: Database } = {},
): Promise<AttachmentDownload> {
  const db = options.db ?? getDb();
  const [record] = await db
    .select({
      storageKey: attachments.storageKey,
      fileName: attachments.fileName,
      contentType: attachments.contentType,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.groupId, access.groupId),
        isNull(attachments.deletedAt),
      ),
    )
    .limit(1);

  if (!record) {
    throw new AuthorizationError(
      "That receipt is not part of this group.",
      "notInGroup",
    );
  }

  const bytes = await getStorage().get(record.storageKey);
  return {
    fileName: record.fileName,
    contentType: record.contentType,
    bytes,
  };
}

export interface AttachmentSummary {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: bigint;
  readonly createdAt: Date;
}

export async function listAttachmentsForExpense(
  groupId: string,
  expenseId: string,
  options: { db?: Database } = {},
): Promise<AttachmentSummary[]> {
  const db = options.db ?? getDb();
  return db
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      contentType: attachments.contentType,
      byteSize: attachments.byteSize,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.groupId, groupId),
        eq(attachments.expenseId, expenseId),
        isNull(attachments.deletedAt),
      ),
    );
}

export async function deleteAttachment(
  access: GroupAccess,
  attachmentId: string,
  options: { db?: Database } = {},
): Promise<void> {
  requirePermission(access, "uploadReceipt");
  const db = options.db ?? getDb();

  const deleted = await db
    .update(attachments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.groupId, access.groupId),
        isNull(attachments.deletedAt),
      ),
    )
    .returning({ storageKey: attachments.storageKey });

  if (deleted.length === 0) {
    throw new AuthorizationError(
      "That receipt is not part of this group.",
      "notInGroup",
    );
  }

  await getStorage()
    .delete(deleted[0].storageKey)
    .catch((error: unknown) => {
      // The row is already marked deleted; a stuck blob is a cleanup problem,
      // not a reason to fail the user's action. The row keeps its key, and the
      // sweeper removes the object again before it removes the row.
      logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        "Failed to remove stored receipt; it will be swept later",
      );
    });
}

/**
 * Removes uploads that were never attached to an expense — the residue of a
 * form the user abandoned, or a transaction that rolled back after the blob
 * was written — and the rows of receipts deleted long ago, objects included.
 * Run by the worker on a schedule.
 */
export async function sweepOrphanedAttachments(
  olderThan: Date,
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const orphans = await db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(
      and(
        isNull(attachments.expenseId),
        isNull(attachments.deletedAt),
        lt(attachments.createdAt, olderThan),
      ),
    )
    .limit(500);

  // `deleteAttachment` removes the object straight away, so for most of these
  // it is already gone and removing it again costs nothing. For the rest this
  // is the "later" that function's log line promises.
  const deleted = await db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(
      and(
        isNotNull(attachments.deletedAt),
        lt(attachments.deletedAt, olderThan),
      ),
    )
    .limit(500);

  return purge(db, [...orphans, ...deleted]);
}

/**
 * Object first, row second — and the row only once its object is gone.
 *
 * The row is the only record of where the object is. Deleting it first, or
 * deleting it whatever the storage said, turns every failed delete into a file
 * nothing can find again. Left in place, a row whose object would not go
 * matches the same query on the next run and is tried again.
 */
async function purge(
  db: Database,
  rows: readonly { id: string; storageKey: string }[],
): Promise<number> {
  const storage = getStorage();
  const removed: string[] = [];
  for (const row of rows) {
    try {
      await storage.delete(row.storageKey);
      removed.push(row.id);
    } catch {
      // Counted below; the key is not worth a log line of its own.
    }
  }

  if (removed.length < rows.length) {
    logger.warn(
      { failed: rows.length - removed.length },
      "Some stored receipts could not be removed; the next sweep retries them",
    );
  }
  if (removed.length > 0) {
    await db.delete(attachments).where(inArray(attachments.id, removed));
  }
  return removed.length;
}

/**
 * The object keys of every receipt a group holds — linked, never linked or
 * already deleted — for a caller about to delete the group.
 *
 * Deleting a group cascades through `attachments`, and those rows are the only
 * record of where each file is. Once they are gone nothing can find the
 * objects again, so a deleted group's receipts, and whatever a photograph of
 * one gives away, would sit in the volume or the bucket for good. The keys are
 * read here, inside the transaction that deletes the group, and the objects
 * removed by `removeStoredReceipts` once it has committed — after, because a
 * rollback must not leave rows pointing at files that no longer exist.
 *
 * The group's row is locked first. An upload holds a lock on the same row
 * while it inserts (see `uploadAttachment`), so one already in flight commits
 * before this reads, and one arriving later waits for the deletion and then
 * fails on its foreign key, taking its own object with it. Nothing slips a row
 * in between this read and the cascade.
 */
export async function storageKeysOfGroup(
  tx: Database,
  groupId: string,
): Promise<string[]> {
  await tx
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.id, groupId))
    .for("update");

  const rows = await tx
    .select({ storageKey: attachments.storageKey })
    .from(attachments)
    .where(eq(attachments.groupId, groupId));
  return rows.map((row) => row.storageKey);
}

/**
 * Removes stored receipts whose rows have already been deleted.
 *
 * Best effort, one object at a time: the deletion this follows has committed,
 * and a bucket that was briefly unreachable is no reason to report it as
 * failed. What could not be removed is logged as a count — never a key, never
 * a file name, which is often a merchant and a date.
 */
export async function removeStoredReceipts(
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const storage = getStorage();
  let failed = 0;
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) {
    logger.warn(
      { failed, total: keys.length },
      "Stored receipts outlived the group they belonged to",
    );
  }
}
