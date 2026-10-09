import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { attachments, expenses, groupMembers } from "@/lib/db/schema";
import {
  ObjectNotFoundError,
  type StorageDriver,
  type StoredObject,
} from "@/lib/storage";
import { createExpense } from "@/modules/expenses/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../../../tests/helpers/factories";
import { createRecoveryKey, decryptWith } from "./age";
import { type BackupBundle } from "./bundle";
import { receiptName } from "./naming";
import { estimateReceipts } from "./receipts";
import {
  createDestination,
  listDestinations,
  runBackup,
  saveBackupKey,
  updateDestination,
  type Seams,
} from "./service";
import type { BackupTransport } from "./transport";

/**
 * Receipts: the part that costs somebody's quota.
 *
 * The properties worth a test are all about *not* doing things: not sending a
 * receipt twice, not sending one that belongs to a group the person does not
 * own, not deleting anything in the cloud, and not letting a first backup of a
 * very large archive hold a worker for an hour.
 */

vi.mock("@/lib/jobs/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/queue")>()),
  publish: vi.fn(async () => "job-id"),
}));

class FakeStorage implements StorageDriver {
  readonly name = "local" as const;
  readonly objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer): Promise<StoredObject> {
    this.objects.set(key, body);
    return { key, byteSize: body.length, checksum: "" };
  }
  async get(key: string) {
    const found = this.objects.get(key);
    if (!found) throw new ObjectNotFoundError(key);
    return found;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
}

class FakeCloud implements BackupTransport {
  readonly files = new Map<string, Uint8Array>();
  readonly receipts = new Map<string, Uint8Array>();
  readonly writes: string[] = [];
  readonly removed: string[] = [];

  private bucket(folder?: string) {
    return folder === "receipts" ? this.receipts : this.files;
  }
  async check() {}
  async ensureDirectory() {}
  async put(name: string, bytes: Uint8Array, folder?: "receipts") {
    this.bucket(folder).set(name, bytes);
    this.writes.push(`${folder ?? "."}/${name}`);
  }
  async list(folder?: "receipts") {
    return [...this.bucket(folder).keys()];
  }
  async remove(name: string, folder?: "receipts") {
    this.bucket(folder).delete(name);
    this.removed.push(`${folder ?? "."}/${name}`);
  }
  async read(name: string, folder?: "receipts") {
    return Buffer.from(this.bucket(folder).get(name) ?? []);
  }
}

let cloud: FakeCloud;
let storage: FakeStorage;
let clock: Date;

const seams = (extra: Partial<Seams> = {}): Seams => ({
  now: () => clock,
  openTransport: async () => cloud,
  storage,
  ...extra,
});

const S3 = {
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  flavour: "Other" as const,
  bucket: "family-backups",
  prefix: "",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "super-secret-access-key",
  pathStyle: false,
};

beforeEach(() => {
  cloud = new FakeCloud();
  storage = new FakeStorage();
  clock = new Date("2026-10-09T03:30:00Z");
});

async function setUp(includeReceipts = true) {
  const owner = await createTestUser({ name: "Amélie" });
  const key = await createRecoveryKey();
  await saveBackupKey(owner.userId, key.recipient);
  const group = await createTestGroup(owner, { name: "Lisbon trip" });
  const { id } = await createDestination(
    owner.userId,
    { provider: "s3", credentials: S3, includeReceipts },
    seams(),
  );
  return { owner, key, group, destinationId: id };
}

/** An expense with one attached receipt, stored the way the app stores it. */
async function expenseWithReceipt(
  group: Awaited<ReturnType<typeof createTestGroup>>,
  content: string,
  name = "ticket.jpg",
) {
  const guest = await addTestParticipant(group.groupId, `Guest ${content}`);
  await createExpense(group.access, {
    description: `Dinner ${content}`,
    notes: "",
    category: "Food",
    amount: "1000",
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: group.ownerParticipantId, amount: "1000" }],
    splitMethod: "equal",
    splitEntries: [
      { participantId: group.ownerParticipantId },
      { participantId: guest },
    ],
  });
  const [expense] = await getDb()
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.description, `Dinner ${content}`));
  const body = Buffer.from(content);
  const storageKey = `key-${content}`;
  await storage.put(storageKey, body);
  const [row] = await getDb()
    .insert(attachments)
    .values({
      groupId: group.groupId,
      expenseId: expense?.id,
      storageKey,
      fileName: name,
      contentType: "image/jpeg",
      byteSize: BigInt(body.length),
      checksum: createHash("sha256").update(body).digest("hex"),
    })
    .returning({ id: attachments.id });
  return { attachmentId: row?.id ?? "", body };
}

async function openBundle(identity: string): Promise<BackupBundle> {
  const name = [...cloud.files.keys()].sort().at(-1) ?? "";
  const plain = await decryptWith(
    identity,
    cloud.files.get(name) ?? new Uint8Array(),
  );
  return JSON.parse(gunzipSync(plain).toString("utf8")) as BackupBundle;
}

describe("with receipts off", () => {
  it("writes none, and leaves the backup file in the format it always was", async () => {
    const { key, group, destinationId } = await setUp(false);
    await expenseWithReceipt(group, "one");

    await runBackup(destinationId, { trigger: "manual", ...seams() });

    expect(cloud.receipts.size).toBe(0);
    expect(await openBundle(key.identity)).not.toHaveProperty("receipts");
  });
});

describe("with receipts on", () => {
  it("sends each receipt encrypted, and the owner's key opens it to the original bytes", async () => {
    const { key, group, destinationId } = await setUp();
    const { attachmentId, body } = await expenseWithReceipt(
      group,
      "dinner-ticket",
    );

    const outcome = await runBackup(destinationId, {
      trigger: "manual",
      ...seams(),
    });

    expect(outcome?.status).toBe("succeeded");
    expect([...cloud.receipts.keys()]).toEqual([receiptName(attachmentId)]);
    const sealed =
      cloud.receipts.get(receiptName(attachmentId)) ?? new Uint8Array();
    expect(Buffer.from(sealed).toString("latin1")).not.toContain(
      "dinner-ticket",
    );
    expect(
      Buffer.from(await decryptWith(key.identity, sealed)).equals(body),
    ).toBe(true);
  });

  it("lists them in the backup, inside the ciphertext, with what a restore needs", async () => {
    const { key, group, destinationId } = await setUp();
    const { attachmentId, body } = await expenseWithReceipt(
      group,
      "dinner-ticket",
      "Ticket 12.jpg",
    );

    await runBackup(destinationId, { trigger: "manual", ...seams() });

    const bundle = await openBundle(key.identity);
    expect(bundle.receipts).toEqual([
      expect.objectContaining({
        id: attachmentId,
        groupId: group.groupId,
        fileName: "Ticket 12.jpg",
        contentType: "image/jpeg",
        byteSize: String(body.length),
        object: `receipts/${receiptName(attachmentId)}`,
      }),
    ]);
  });

  it("never sends a receipt twice", async () => {
    const { group, destinationId } = await setUp();
    await expenseWithReceipt(group, "first");
    await runBackup(destinationId, { trigger: "manual", ...seams() });
    cloud.writes.length = 0;

    clock = new Date("2026-10-10T03:30:00Z");
    await runBackup(destinationId, { trigger: "manual", ...seams() });

    expect(
      cloud.writes.filter((write) => write.startsWith("receipts/")),
    ).toEqual([]);
  });

  it("sends only the new one the next time", async () => {
    const { key, group, destinationId } = await setUp();
    await expenseWithReceipt(group, "first");
    await runBackup(destinationId, { trigger: "manual", ...seams() });
    cloud.writes.length = 0;
    const second = await expenseWithReceipt(group, "second");

    clock = new Date("2026-10-10T03:30:00Z");
    await runBackup(destinationId, { trigger: "manual", ...seams() });

    expect(
      cloud.writes.filter((write) => write.startsWith("receipts/")),
    ).toEqual([`receipts/${receiptName(second.attachmentId)}`]);
    expect((await openBundle(key.identity)).receipts).toHaveLength(2);
  });

  it("only takes receipts from groups the person owns and has not left out", async () => {
    const { owner, group, destinationId } = await setUp();
    const kept = await expenseWithReceipt(group, "mine");

    const skipped = await createTestGroup(owner, { name: "Left out" });
    await expenseWithReceipt(skipped, "left-out");
    await updateDestination(
      owner.userId,
      destinationId,
      { excludedGroupIds: [skipped.groupId] },
      seams(),
    );

    const other = await createTestUser({ name: "Blaise" });
    const theirs = await createTestGroup(other, { name: "Blaise's" });
    await expenseWithReceipt(theirs, "not-mine");
    const participant = await addTestParticipant(theirs.groupId, "Amélie");
    await getDb().insert(groupMembers).values({
      groupId: theirs.groupId,
      userId: owner.userId,
      participantId: participant,
      role: "member",
    });

    await runBackup(destinationId, { trigger: "manual", ...seams() });

    expect([...cloud.receipts.keys()]).toEqual([
      receiptName(kept.attachmentId),
    ]);
  });

  it("leaves out a receipt that was deleted", async () => {
    const { group, destinationId } = await setUp();
    const gone = await expenseWithReceipt(group, "gone");
    await getDb()
      .update(attachments)
      .set({ deletedAt: new Date() })
      .where(eq(attachments.id, gone.attachmentId));

    await runBackup(destinationId, { trigger: "manual", ...seams() });

    expect(cloud.receipts.size).toBe(0);
  });

  it("notes a receipt whose file has gone from storage and carries on without it", async () => {
    const { key, group, destinationId } = await setUp();
    const lost = await expenseWithReceipt(group, "lost");
    const kept = await expenseWithReceipt(group, "kept");
    storage.objects.delete("key-lost");

    const outcome = await runBackup(destinationId, {
      trigger: "manual",
      ...seams(),
    });

    expect(outcome?.status).toBe("succeeded");
    expect([...cloud.receipts.keys()]).toEqual([
      receiptName(kept.attachmentId),
    ]);
    expect((await openBundle(key.identity)).receipts?.map((r) => r.id)).toEqual(
      [kept.attachmentId],
    );
    expect(lost.attachmentId).toBeDefined();
    // Nothing is waiting: retrying would not bring the file back.
    const [view] = await listDestinations(
      (await getDb().select().from(groupMembers))[0]?.userId ?? "",
    );
    expect(view?.latestRun?.receiptsPending).toBe(0);
  });

  it("stops at its budget, says how many remain, and comes back within the hour", async () => {
    const { owner, key, group, destinationId } = await setUp();
    for (const name of ["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"]) {
      await expenseWithReceipt(group, name);
    }

    await runBackup(destinationId, {
      trigger: "schedule",
      ...seams({ receiptByteBudget: 15 }),
    });

    expect(cloud.receipts.size).toBe(2);
    const [view] = await listDestinations(owner.userId);
    expect(view?.latestRun).toMatchObject({
      receiptsWritten: 2,
      receiptsPending: 1,
    });
    expect(view?.nextRunAt).toEqual(new Date("2026-10-09T04:30:00Z"));
    // Only what is safely there is listed.
    expect((await openBundle(key.identity)).receipts).toHaveLength(2);

    clock = new Date("2026-10-09T04:30:00Z");
    await runBackup(destinationId, { trigger: "schedule", ...seams() });

    expect(cloud.receipts.size).toBe(3);
    const [after] = await listDestinations(owner.userId);
    expect(after?.latestRun).toMatchObject({
      receiptsWritten: 1,
      receiptsPending: 0,
    });
    expect(after?.nextRunAt).toEqual(new Date("2026-10-10T04:30:00Z"));
  });

  it("never deletes a receipt, however many backups it keeps", async () => {
    const { group, destinationId, owner } = await setUp();
    await updateDestination(
      owner.userId,
      destinationId,
      { keepLast: 1 },
      seams(),
    );
    await expenseWithReceipt(group, "first");

    for (let day = 9; day <= 12; day += 1) {
      clock = new Date(`2026-10-${String(day).padStart(2, "0")}T03:30:00Z`);
      await expenseWithReceipt(group, `receipt-${day}`);
      await runBackup(destinationId, { trigger: "manual", ...seams() });
    }

    expect(cloud.files.size).toBe(1);
    expect(cloud.receipts.size).toBe(5);
    expect(
      cloud.removed.filter((removal) => removal.startsWith("receipts/")),
    ).toEqual([]);
  });

  it("counts as a change when a receipt arrives, so a quiet night still notices", async () => {
    const { group, destinationId } = await setUp();
    await runBackup(destinationId, { trigger: "schedule", ...seams() });
    await expenseWithReceipt(group, "late");
    // The expense itself is new data too; what is checked here is the receipts
    // half, so look at the file count and that the receipt landed.
    clock = new Date("2026-10-10T03:30:00Z");

    const outcome = await runBackup(destinationId, {
      trigger: "schedule",
      ...seams(),
    });

    expect(outcome?.status).toBe("succeeded");
    expect(cloud.receipts.size).toBe(1);
  });
});

describe("estimating the cost", () => {
  it("counts the receipts and bytes that would be sent, for the screen to say first", async () => {
    const { owner, group } = await setUp(false);
    await expenseWithReceipt(group, "twelve-bytes");
    await expenseWithReceipt(group, "another-one!");

    expect(await estimateReceipts(owner.userId)).toEqual({
      count: 2,
      bytes: 24,
    });
  });

  it("leaves out groups the person excluded, groups they do not own, and deleted receipts", async () => {
    const { owner, group } = await setUp(false);
    await expenseWithReceipt(group, "counted");
    const excluded = await createTestGroup(owner, { name: "Excluded" });
    await expenseWithReceipt(excluded, "excluded-one");
    const other = await createTestUser();
    const theirs = await createTestGroup(other);
    await expenseWithReceipt(theirs, "theirs");
    const deleted = await expenseWithReceipt(group, "deleted");
    await getDb()
      .update(attachments)
      .set({ deletedAt: new Date() })
      .where(eq(attachments.id, deleted.attachmentId));

    expect(
      await estimateReceipts(owner.userId, { excluding: [excluded.groupId] }),
    ).toEqual({ count: 1, bytes: 7 });
  });

  it("is nothing for somebody with no receipts", async () => {
    const owner = await createTestUser();

    expect(await estimateReceipts(owner.userId)).toEqual({
      count: 0,
      bytes: 0,
    });
  });
});
