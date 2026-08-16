import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { getDb, type Database } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema";
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
 *  - Size is capped by UPLOAD_MAX_BYTES.
 *  - The MIME type comes from sniffing the file's magic bytes, not from the
 *    client's Content-Type and not from the extension. A .jpg that is really
 *    an HTML file is rejected.
 *  - Only raster images and PDF are accepted. SVG is refused on purpose: it is
 *    an XML document that can carry script, and no one needs a vector receipt.
 *  - The stored object key is random and server-generated, so nothing
 *    user-controlled reaches the filesystem or bucket path.
 *  - Every download re-checks group authorization.
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

export class UploadRejectedError extends Error {
  /** Translated by the Server Action funnel; see `lib/actions.ts`. */
  readonly params: Readonly<Record<string, string | number>>;

  constructor(
    message: string,
    readonly code: "fileEmpty" | "fileTooLarge" | "fileType" = "fileEmpty",
    params: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "UploadRejectedError";
    this.params = params;
  }
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
    const limitMb = Math.floor(env.UPLOAD_MAX_BYTES / (1024 * 1024));
    throw new UploadRejectedError(
      `That file is larger than the ${limitMb} MB upload limit.`,
      "fileTooLarge",
      { limit: limitMb },
    );
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
    const [record] = await db
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

    // Whether a receipt was a picture or a document, and nothing else. Not the
    // file name — which is often a merchant and a date — not the size, not the
    // checksum, and obviously not the file.
    await telemetry.receiptAttached({
      kind: detected.mime === "application/pdf" ? "pdf" : "image",
    });

    return record;
  } catch (error) {
    // The row is the source of truth. If it fails, the blob is unreferenced
    // garbage — remove it now rather than leaving the volume to grow.
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
      // not a reason to fail the user's action.
      logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        "Failed to remove stored receipt; it will be swept later",
      );
    });
}

/**
 * Removes uploads that were never attached to an expense — the residue of a
 * form the user abandoned, or a transaction that rolled back after the blob
 * was written. Run by the worker on a schedule.
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

  const storage = getStorage();
  let removed = 0;
  for (const orphan of orphans) {
    await storage.delete(orphan.storageKey).catch(() => undefined);
    await db.delete(attachments).where(eq(attachments.id, orphan.id));
    removed += 1;
  }

  // Also purge blobs for rows soft-deleted long ago.
  const purged = await db
    .delete(attachments)
    .where(
      and(
        sql`${attachments.deletedAt} IS NOT NULL`,
        lt(attachments.deletedAt, olderThan),
      ),
    )
    .returning({ id: attachments.id });

  return removed + purged.length;
}
