import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { attachments, groupMembers, participants } from "@/lib/db/schema";
import { LocalStorageDriver, setStorageDriver } from "@/lib/storage";
import {
  GROUP_STORAGE_MAX_BYTES,
  GROUP_STORAGE_MAX_FILES,
  UploadRejectedError,
  deleteAttachment,
  sweepOrphanedAttachments,
  uploadAttachment,
} from "@/modules/attachments/service";
import { deleteAccount } from "@/modules/auth/service";
import { createExpense, updateExpense } from "@/modules/expenses/service";
import { deleteGroup } from "@/modules/groups/service";
import {
  createTestGroup,
  createTestUser,
  isoToday,
  type TestGroup,
} from "../helpers/factories";

/**
 * Where a receipt's file goes when its row does.
 *
 * The rows in `attachments` are the only record of where each object sits in
 * the volume or the bucket, and a cascade removes rows without a word to the
 * storage driver. Every test here ends by asking the driver, not the
 * database, whether the file is still there — a check against the rows alone
 * would pass with every photograph still on disk.
 */

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100" +
    "05fe02fea7d4e2110000000049454e44ae426082",
  "hex",
);

/** The local driver, with a switch that makes every delete fail. */
class FlakyDriver extends LocalStorageDriver {
  failDeletes = false;

  override async delete(key: string): Promise<void> {
    if (this.failDeletes) throw new Error("bucket unreachable");
    return super.delete(key);
  }
}

let storageRoot: string;
let storage: FlakyDriver;

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "balancia-receipts-"));
  storage = new FlakyDriver(storageRoot);
  setStorageDriver(storage);
});

beforeEach(() => {
  storage.failDeletes = false;
});

afterAll(async () => {
  setStorageDriver(undefined);
  await rm(storageRoot, { recursive: true, force: true });
});

async function keyOf(attachmentId: string): Promise<string> {
  const [row] = await getDb()
    .select({ storageKey: attachments.storageKey })
    .from(attachments)
    .where(eq(attachments.id, attachmentId));
  return row.storageKey;
}

async function upload(group: TestGroup, name = "receipt.png") {
  const uploaded = await uploadAttachment(group.access, { name, bytes: PNG });
  return { id: uploaded.id, key: await keyOf(uploaded.id) };
}

function expenseWith(group: TestGroup, attachmentIds: string[]) {
  return createExpense(group.access, {
    description: "Dinner",
    notes: "",
    category: "Food",
    amount: "3000",
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
    splitMethod: "equal",
    splitEntries: [{ participantId: group.ownerParticipantId }],
    attachmentIds,
  });
}

describe("deleting a group", () => {
  it("removes every receipt it held from storage", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);

    // One of each kind of row the cascade takes: on an expense, never
    // attached to anything, and already deleted.
    const linked = await upload(group);
    await expenseWith(group, [linked.id]);
    const unlinked = await upload(group);
    const removed = await upload(group);
    await deleteAttachment(group.access, removed.id);

    await deleteGroup(group.access);

    for (const { key } of [linked, unlinked, removed]) {
      expect(await storage.exists(key)).toBe(false);
    }
  });

  it("leaves another group's receipts alone", async () => {
    const owner = await createTestUser();
    const doomed = await createTestGroup(owner, { name: "Doomed" });
    const kept = await createTestGroup(owner, { name: "Kept" });
    await upload(doomed);
    const survivor = await upload(kept);

    await deleteGroup(doomed.access);

    expect(await storage.exists(survivor.key)).toBe(true);
  });

  it("still deletes the group when the storage cannot be reached", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    await upload(group);
    storage.failDeletes = true;

    await expect(deleteGroup(group.access)).resolves.toBeUndefined();
  });
});

describe("deleting an account", () => {
  it("removes the receipts of a group nobody else could open", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { name: "Solo" });
    const receipt = await upload(group);

    await deleteAccount(actor.userId);

    expect(await storage.exists(receipt.key)).toBe(false);
  });

  it("keeps the receipts of a group that lives on without the account", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { name: "Shared" });
    const receipt = await upload(group);

    const other = await createTestUser();
    const db = getDb();
    const [participant] = await db
      .insert(participants)
      .values({
        groupId: group.groupId,
        displayName: other.name,
        userId: other.userId,
      })
      .returning({ id: participants.id });
    await db.insert(groupMembers).values({
      groupId: group.groupId,
      userId: other.userId,
      participantId: participant.id,
      role: "member",
    });

    await deleteAccount(actor.userId);

    expect(await storage.exists(receipt.key)).toBe(true);
  });
});

describe("the sweeper", () => {
  const dayAgo = () => new Date(Date.now() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = () => new Date(Date.now() - 48 * 60 * 60 * 1000);

  it("removes the file of a receipt deleted long ago, with its row", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const receipt = await upload(group);
    await expenseWith(group, [receipt.id]);

    // Deleted while the storage was unreachable: the row is marked, the file
    // is still there, and the log line promised it would be swept later.
    storage.failDeletes = true;
    await deleteAttachment(group.access, receipt.id);
    storage.failDeletes = false;
    expect(await storage.exists(receipt.key)).toBe(true);

    await getDb()
      .update(attachments)
      .set({ deletedAt: twoDaysAgo() })
      .where(eq(attachments.id, receipt.id));

    expect(await sweepOrphanedAttachments(dayAgo())).toBe(1);
    expect(await storage.exists(receipt.key)).toBe(false);
    expect(
      await getDb()
        .select()
        .from(attachments)
        .where(eq(attachments.id, receipt.id)),
    ).toHaveLength(0);
  });

  it("keeps the row when the file will not go, and tries again next time", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const orphan = await upload(group);
    await getDb()
      .update(attachments)
      .set({ createdAt: twoDaysAgo() })
      .where(eq(attachments.id, orphan.id));

    storage.failDeletes = true;
    expect(await sweepOrphanedAttachments(dayAgo())).toBe(0);
    // The row is the only record of where the file is, so it stays.
    expect(
      await getDb()
        .select()
        .from(attachments)
        .where(eq(attachments.id, orphan.id)),
    ).toHaveLength(1);

    storage.failDeletes = false;
    expect(await sweepOrphanedAttachments(dayAgo())).toBe(1);
    expect(await storage.exists(orphan.key)).toBe(false);
  });
});

describe("linking receipts to an expense", () => {
  it("does not move a receipt off the expense it is already on", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const receipt = await upload(group);
    const first = await expenseWith(group, [receipt.id]);

    // A second expense naming the same id, on creation and on edit.
    const second = await expenseWith(group, [receipt.id]);
    await updateExpense(group.access, second, {
      description: "Dinner",
      notes: "",
      category: "Food",
      amount: "3000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: group.ownerParticipantId }],
      attachmentIds: [receipt.id],
    });

    const [row] = await getDb()
      .select({ expenseId: attachments.expenseId })
      .from(attachments)
      .where(eq(attachments.id, receipt.id));
    expect(row.expenseId).toBe(first);
  });

  it("still links a fresh upload, and keeps one the expense already holds", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const kept = await upload(group);
    const expense = await expenseWith(group, [kept.id]);
    const added = await upload(group);

    await updateExpense(group.access, expense, {
      description: "Dinner",
      notes: "",
      category: "Food",
      amount: "3000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: group.ownerParticipantId }],
      attachmentIds: [kept.id, added.id],
    });

    const rows = await getDb()
      .select({ expenseId: attachments.expenseId })
      .from(attachments)
      .where(eq(attachments.groupId, group.groupId));
    expect(rows.map((row) => row.expenseId)).toEqual([expense, expense]);
  });
});

describe("the per-group ceiling", () => {
  /** Rows standing in for receipts already stored; no files behind them. */
  async function fill(group: TestGroup, files: number, bytesEach: bigint) {
    await getDb().execute(sql`
      INSERT INTO attachments (group_id, storage_key, file_name, content_type, byte_size, checksum)
      SELECT ${group.groupId}::uuid, 'receipts/filler/' || gen_random_uuid(), 'filler.png',
             'image/png', ${bytesEach.toString()}::bigint, 'x'
      FROM generate_series(1, ${files}::int)
    `);
  }

  async function filesOnDisk(group: TestGroup): Promise<number> {
    const { readdir } = await import("node:fs/promises");
    return readdir(path.join(storageRoot, "receipts", group.groupId))
      .then((names) => names.length)
      .catch(() => 0);
  }

  it("refuses an upload that would take a group past its bytes", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    await fill(group, 1, BigInt(GROUP_STORAGE_MAX_BYTES) - 10n);

    const refusal = await uploadAttachment(group.access, {
      name: "one-too-many.png",
      bytes: PNG,
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(UploadRejectedError);
    expect((refusal as UploadRejectedError).code).toBe("groupStorageFull");
    // Nothing of the refused file stays behind.
    expect(await filesOnDisk(group)).toBe(0);
  });

  it("refuses an upload past the file count", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    await fill(group, GROUP_STORAGE_MAX_FILES, 1n);

    await expect(
      uploadAttachment(group.access, { name: "x.png", bytes: PNG }),
    ).rejects.toMatchObject({ code: "groupStorageFull" });
  });

  it("counts what is live, not what has been deleted", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    await fill(group, 1, BigInt(GROUP_STORAGE_MAX_BYTES));
    await getDb()
      .update(attachments)
      .set({ deletedAt: new Date() })
      .where(eq(attachments.groupId, group.groupId));

    await expect(
      uploadAttachment(group.access, { name: "fits.png", bytes: PNG }),
    ).resolves.toMatchObject({ contentType: "image/png" });
  });

  it("is one group's ceiling, not the instance's", async () => {
    const owner = await createTestUser();
    const full = await createTestGroup(owner, { name: "Full" });
    const roomy = await createTestGroup(owner, { name: "Roomy" });
    await fill(full, 1, BigInt(GROUP_STORAGE_MAX_BYTES));

    await expect(
      uploadAttachment(roomy.access, { name: "fits.png", bytes: PNG }),
    ).resolves.toMatchObject({ contentType: "image/png" });
  });
});
