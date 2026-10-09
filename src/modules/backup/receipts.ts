import "server-only";
import { and, asc, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { attachments, groupMembers } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { ObjectNotFoundError, type StorageDriver } from "@/lib/storage";
import { encryptTo } from "./age";
import { parseReceiptName, receiptName } from "./naming";
import type { BackupTransport } from "./transport";

/**
 * Backing up receipts: the attached photos and PDFs.
 *
 * They are the heavy part. A group's data is a few hundred kilobytes; its
 * receipts can be a gigabyte, in a cloud account with a quota, over somebody's
 * upload bandwidth. So receipts are a second, separate choice that is off until
 * a person has read what it costs, and they are written differently from the
 * data:
 *
 *  - **One object per receipt, encrypted on its own, written once.** A receipt
 *    never changes after it is uploaded, so there is nothing to gain from
 *    sending it again. The first backup is the expensive one; every later one
 *    sends only what is new, which is usually nothing. Re-sending every receipt
 *    nightly inside a fresh archive would turn a gigabyte into a gigabyte a day.
 *  - **The data backup lists them.** The `receipts` array in the backup file
 *    says which attachment is which expense and what it was called — inside the
 *    ciphertext, so the cloud sees only opaque names (`receipt-<id>.age`).
 *  - **A budget per run.** A first backup of thousands of receipts does not hold
 *    a worker for an hour: it uploads up to a ceiling and the next run (within
 *    the hour) carries on, the screen saying how many remain.
 *  - **Never deleted.** Retention keeps the newest N data backups. It does not
 *    touch receipts, which are shared by all of them.
 */

export interface ReceiptRef {
  readonly id: string;
  readonly groupId: string;
  readonly expenseId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly storageKey: string;
}

/** What the data backup records about a receipt that is safely in the cloud. */
export interface ReceiptManifestEntry {
  readonly id: string;
  readonly groupId: string;
  readonly expenseId: string;
  readonly fileName: string;
  readonly contentType: string;
  /** Bytes before encryption, as a string like every number in a backup. */
  readonly byteSize: string;
  /** The checksum recorded when it was uploaded, so a restore can verify it. */
  readonly checksum: string;
  /** Where it is, relative to the backup folder. */
  readonly object: string;
}

/** Most bytes one run will send. The next run carries on. */
export const RECEIPT_BYTE_BUDGET = 256 * 1024 * 1024;
/** Longest one run will keep uploading receipts. */
export const RECEIPT_TIME_BUDGET_MS = 15 * 60 * 1000;

/**
 * The receipts of the groups this person owns, less those they left out.
 *
 * The ownership join is here and not left to the caller, so a receipt of a
 * group someone only belongs to cannot be reached through this function with
 * any argument. Receipts of deleted expenses are gone with them (the foreign
 * key cascades); a receipt with no expense was never attached to anything.
 */
export async function listReceipts(
  userId: string,
  options: { excluding?: readonly string[]; db?: Database } = {},
): Promise<ReceiptRef[]> {
  const db = options.db ?? getDb();
  const excluding = options.excluding ?? [];
  const rows = await db
    .select({
      id: attachments.id,
      groupId: attachments.groupId,
      expenseId: attachments.expenseId,
      fileName: attachments.fileName,
      contentType: attachments.contentType,
      byteSize: attachments.byteSize,
      checksum: attachments.checksum,
      storageKey: attachments.storageKey,
    })
    .from(attachments)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, attachments.groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.role, "owner"),
      ),
    )
    .where(
      and(
        isNull(attachments.deletedAt),
        isNotNull(attachments.expenseId),
        excluding.length > 0
          ? notInArray(attachments.groupId, [...excluding])
          : undefined,
      ),
    )
    .orderBy(asc(attachments.createdAt), asc(attachments.id));

  return rows.flatMap((row) =>
    row.expenseId === null
      ? []
      : [
          {
            ...row,
            expenseId: row.expenseId,
            byteSize: Number(row.byteSize),
          },
        ],
  );
}

export interface ReceiptEstimate {
  readonly count: number;
  /** Bytes, before encryption. Encryption adds a few dozen per file. */
  readonly bytes: number;
}

/**
 * What switching receipts on would cost, for the screen to say before it
 * happens: a number a person can weigh against their quota is worth more than
 * any amount of explanation.
 */
export async function estimateReceipts(
  userId: string,
  options: { excluding?: readonly string[]; db?: Database } = {},
): Promise<ReceiptEstimate> {
  const db = options.db ?? getDb();
  const excluding = options.excluding ?? [];
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<string>`coalesce(sum(${attachments.byteSize}), 0)::text`,
    })
    .from(attachments)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, attachments.groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.role, "owner"),
      ),
    )
    .where(
      and(
        isNull(attachments.deletedAt),
        isNotNull(attachments.expenseId),
        excluding.length > 0
          ? notInArray(attachments.groupId, [...excluding])
          : undefined,
      ),
    );
  return { count: row?.count ?? 0, bytes: Number(row?.bytes ?? 0) };
}

export interface ReceiptSync {
  /** Every receipt now in the cloud, for the data backup to list. */
  readonly manifest: readonly ReceiptManifestEntry[];
  readonly written: number;
  /** Receipts still to send, not counting any whose file is missing locally. */
  readonly pending: number;
  /** Receipts the database lists and the storage no longer has. */
  readonly missing: number;
}

function entryFor(receipt: ReceiptRef): ReceiptManifestEntry {
  return {
    id: receipt.id,
    groupId: receipt.groupId,
    expenseId: receipt.expenseId,
    fileName: receipt.fileName,
    contentType: receipt.contentType,
    byteSize: String(receipt.byteSize),
    checksum: receipt.checksum,
    object: `receipts/${receiptName(receipt.id)}`,
  };
}

export async function syncReceipts(input: {
  readonly receipts: readonly ReceiptRef[];
  readonly recipient: string;
  readonly transport: BackupTransport;
  readonly storage: StorageDriver;
  readonly now?: () => number;
  readonly byteBudget?: number;
  readonly timeBudgetMs?: number;
}): Promise<ReceiptSync> {
  const clock = input.now ?? Date.now;
  const startedAt = clock();
  const byteBudget = input.byteBudget ?? RECEIPT_BYTE_BUDGET;
  const timeBudget = input.timeBudgetMs ?? RECEIPT_TIME_BUDGET_MS;

  const have = new Set<string>();
  for (const name of await input.transport.list("receipts")) {
    const id = parseReceiptName(name);
    if (id) have.add(id);
  }

  const wanted = input.receipts.filter((receipt) => !have.has(receipt.id));
  const manifest: ReceiptManifestEntry[] = input.receipts
    .filter((receipt) => have.has(receipt.id))
    .map(entryFor);
  if (wanted.length === 0) {
    return { manifest, written: 0, pending: 0, missing: 0 };
  }

  await input.transport.ensureDirectory("receipts");

  let written = 0;
  let missing = 0;
  let sent = 0;
  let stopped = false;
  for (const receipt of wanted) {
    if (stopped || sent >= byteBudget || clock() - startedAt >= timeBudget) {
      stopped = true;
      continue;
    }

    let plain: Buffer;
    try {
      plain = await input.storage.get(receipt.storageKey);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        // The database remembers a file the storage has lost. Not this run's
        // fault and not fixable by retrying; the data backup simply does not
        // list it, and the count says how many.
        logger.warn(
          { attachmentId: receipt.id },
          "A receipt is in the database but not in storage; skipped",
        );
        missing += 1;
        continue;
      }
      throw error;
    }

    const sealed = await encryptTo(input.recipient, plain);
    await input.transport.put(receiptName(receipt.id), sealed, "receipts");
    manifest.push(entryFor(receipt));
    written += 1;
    sent += plain.byteLength;
  }

  return {
    manifest,
    written,
    pending: wanted.length - written - missing,
    missing,
  };
}
