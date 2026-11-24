import { gunzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import {
  backupDestinations,
  backupRuns,
  groupMembers,
  users,
} from "@/lib/db/schema";
import { open } from "@/lib/security/secret-box";
import { createExpense } from "@/modules/expenses/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../../../tests/helpers/factories";
import { createRecoveryKey, decryptWith } from "./age";
import { type BackupBundle } from "./bundle";
import { BackupError } from "./errors";
import { bundleName, destinationTag } from "./naming";
import {
  closeRunsInHand,
  createDestination,
  deleteDestination,
  finishSetup,
  getBackupKey,
  listBackupFiles,
  listDestinations,
  listRuns,
  pruneRuns,
  readBackupFile,
  reapStaleRuns,
  reapStaleSetups,
  replaceCredentials,
  requestRun,
  runBackup,
  saveBackupKey,
  sweepDueBackups,
  updateDestination,
  type Seams,
} from "./service";
import type { BackupTransport } from "./transport";

/**
 * Cloud backup against a real PostgreSQL and a fake cloud.
 *
 * The fake is a map of files, so every assertion about "what was written,
 * where, and how many were kept" is an assertion about bytes a person could
 * have downloaded. The files are decrypted with the recovery key and read back
 * as JSON — the check that matters is not that something was uploaded but that
 * the owner could, in ten years, get their groups out of it.
 */

const published = vi.hoisted(() => ({
  jobs: [] as { queue: string; payload: unknown }[],
  fail: false,
}));

vi.mock("@/lib/jobs/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/queue")>()),
  publish: vi.fn(async (queue: string, payload: unknown) => {
    if (published.fail) throw new Error("queue down");
    published.jobs.push({ queue, payload });
    return "job-id";
  }),
}));

class FakeCloud implements BackupTransport {
  readonly files = new Map<string, Uint8Array>();
  failWith: BackupError | undefined;
  checks = 0;

  async check() {
    this.checks += 1;
    if (this.failWith) throw this.failWith;
  }
  async ensureDirectory() {}
  async put(name: string, bytes: Uint8Array) {
    if (this.failWith) throw this.failWith;
    this.files.set(name, bytes);
  }
  async list() {
    return [...this.files.keys()];
  }
  async remove(name: string) {
    this.files.delete(name);
  }
  async read(name: string) {
    return Buffer.from(this.files.get(name) ?? []);
  }
}

let cloud: FakeCloud;
let clock: Date;

function seams(): Seams {
  return {
    now: () => clock,
    openTransport: async () => cloud,
  };
}

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

/** The file a run of destination `id` writes at `at`. */
const nameAt = (id: string, at: Date) => bundleName(at, destinationTag(id));

async function setUp() {
  const owner = await createTestUser({ name: "Amélie" });
  const key = await createRecoveryKey();
  await saveBackupKey(owner.userId, key.recipient);
  return { owner, key };
}

async function openFile(
  identity: string,
  name = [...cloud.files.keys()].sort().at(-1) ?? "",
): Promise<BackupBundle> {
  const bytes = cloud.files.get(name);
  if (!bytes) throw new Error(`no file ${name}`);
  const plain = await decryptWith(identity, bytes);
  return JSON.parse(gunzipSync(plain).toString("utf8")) as BackupBundle;
}

async function expense(
  group: Awaited<ReturnType<typeof createTestGroup>>,
  description = "Dinner",
) {
  const guest = await addTestParticipant(group.groupId, `Guest ${description}`);
  await createExpense(group.access, {
    description,
    notes: "",
    category: "Food",
    amount: "4200",
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: group.ownerParticipantId, amount: "4200" }],
    splitMethod: "equal",
    splitEntries: [
      { participantId: group.ownerParticipantId },
      { participantId: guest },
    ],
  });
}

beforeEach(() => {
  cloud = new FakeCloud();
  clock = new Date("2026-10-09T03:30:00Z");
  published.jobs.length = 0;
  published.fail = false;
});

describe("the recovery key", () => {
  it("keeps the public half and its fingerprint", async () => {
    const owner = await createTestUser();
    const { recipient } = await createRecoveryKey();

    const saved = await saveBackupKey(owner.userId, recipient);

    expect(saved.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect((await getBackupKey(owner.userId))?.recipient).toBe(recipient);
  });

  it("will not hold the private half, whatever the client sent", async () => {
    const owner = await createTestUser();
    const { identity } = await createRecoveryKey();

    await expect(saveBackupKey(owner.userId, identity)).rejects.toMatchObject({
      code: "invalidKey",
    });
    expect(await getBackupKey(owner.userId)).toBeNull();
  });

  it("replaces the key when asked, and only that person's", async () => {
    const ada = await createTestUser();
    const sam = await createTestUser();
    const first = await createRecoveryKey();
    const second = await createRecoveryKey();
    await saveBackupKey(ada.userId, first.recipient);
    await saveBackupKey(sam.userId, first.recipient);

    await saveBackupKey(ada.userId, second.recipient);

    expect((await getBackupKey(ada.userId))?.recipient).toBe(second.recipient);
    expect((await getBackupKey(sam.userId))?.recipient).toBe(first.recipient);
  });
});

describe("a new recovery key", () => {
  it("brings the next backup forward, and that backup is written though nothing else changed", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3, frequency: "weekly" },
      seams(),
    );
    await runBackup(id, { trigger: "schedule", ...seams() });

    // The old key is lost; a new one is made the next morning.
    const next = await createRecoveryKey();
    clock = new Date("2026-10-10T08:00:00Z");
    await saveBackupKey(owner.userId, next.recipient, { now: clock });

    const [view] = await listDestinations(owner.userId);
    expect(view?.nextRunAt).toEqual(clock);

    clock = new Date("2026-10-10T08:10:00Z");
    const outcome = await runBackup(id, { trigger: "schedule", ...seams() });

    expect(outcome?.status).toBe("succeeded");
    expect(cloud.files.size).toBe(2);
    // The newest copy is one the new key opens.
    const bundle = await openFile(next.identity);
    expect(bundle.groups).toHaveLength(1);
  });

  it("leaves the schedule alone when the same key is saved again, and a paused destination paused", async () => {
    const { owner, key } = await setUp();
    await createTestGroup(owner);
    const { id: running } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    const { id: paused } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await runBackup(running, { trigger: "schedule", ...seams() });
    await runBackup(paused, { trigger: "schedule", ...seams() });
    await updateDestination(owner.userId, paused, { paused: true }, seams());
    const before = await listDestinations(owner.userId);

    clock = new Date("2026-10-09T12:00:00Z");
    await saveBackupKey(owner.userId, key.recipient, { now: clock });
    expect(
      (await listDestinations(owner.userId)).map((view) => view.nextRunAt),
    ).toEqual(before.map((view) => view.nextRunAt));

    await saveBackupKey(owner.userId, (await createRecoveryKey()).recipient, {
      now: clock,
    });
    const after = await listDestinations(owner.userId);
    expect(after.find((view) => view.id === running)?.nextRunAt).toEqual(clock);
    expect(after.find((view) => view.id === paused)).toMatchObject({
      status: "paused",
      nextRunAt: before.find((view) => view.id === paused)?.nextRunAt,
    });
  });
});

describe("creating a destination", () => {
  it("needs a recovery key first", async () => {
    const owner = await createTestUser();

    await expect(
      createDestination(
        owner.userId,
        { provider: "s3", credentials: S3 },
        seams(),
      ),
    ).rejects.toMatchObject({ code: "noKey" });
  });

  it("proves the destination works before keeping it", async () => {
    const { owner } = await setUp();
    cloud.failWith = new BackupError("forbidden", "AccessDenied");

    await expect(
      createDestination(
        owner.userId,
        { provider: "s3", credentials: S3 },
        seams(),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await listDestinations(owner.userId)).toEqual([]);
  });

  it("refuses details that do not fit the provider", async () => {
    const { owner } = await setUp();

    await expect(
      createDestination(
        owner.userId,
        { provider: "s3", credentials: { ...S3, bucket: "NOT A BUCKET" } },
        seams(),
      ),
    ).rejects.toMatchObject({ code: "invalidDetails" });
  });

  it("stores the credentials sealed, never in the clear", async () => {
    const { owner } = await setUp();

    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );

    const [row] = await getDb()
      .select()
      .from(backupDestinations)
      .where(eq(backupDestinations.id, id));
    expect(row?.credentials).toMatch(/^v1\./);
    expect(row?.credentials).not.toContain("super-secret-access-key");
    expect(row?.credentials).not.toContain("AKIAEXAMPLE");
  });

  it("never offers a screen anything it could leak", async () => {
    const { owner } = await setUp();
    await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );

    const [view] = await listDestinations(owner.userId);

    expect(JSON.stringify(view)).not.toContain("super-secret-access-key");
    expect(view).not.toHaveProperty("credentials");
    expect(view?.label).toBe("S3 · family-backups");
    expect(view?.status).toBe("active");
  });

  it("stops at five", async () => {
    const { owner } = await setUp();
    for (let index = 0; index < 5; index += 1) {
      await createDestination(
        owner.userId,
        { provider: "s3", credentials: S3 },
        seams(),
      );
    }

    await expect(
      createDestination(
        owner.userId,
        { provider: "s3", credentials: S3 },
        seams(),
      ),
    ).rejects.toMatchObject({ code: "tooMany" });
  });
});

describe("whose destination it is", () => {
  it("is invisible to everybody else, in every operation", async () => {
    const { owner } = await setUp();
    const stranger = await createTestUser();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );

    expect(await listDestinations(stranger.userId)).toEqual([]);
    await expect(
      updateDestination(stranger.userId, id, { paused: true }, seams()),
    ).rejects.toMatchObject({ code: "notFound" });
    await expect(
      deleteDestination(stranger.userId, id, seams()),
    ).rejects.toMatchObject({
      code: "notFound",
    });
    await expect(
      requestRun(stranger.userId, id, seams()),
    ).rejects.toMatchObject({
      code: "notFound",
    });
    await expect(listRuns(stranger.userId, id)).rejects.toMatchObject({
      code: "notFound",
    });
    expect(await listDestinations(owner.userId)).toHaveLength(1);
  });
});

describe("a backup run", () => {
  it("writes the owner's groups, encrypted so that only the recovery key opens them", async () => {
    const { owner, key } = await setUp();
    const group = await createTestGroup(owner, { name: "Lisbon trip" });
    await expense(group, "Dinner");
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );

    const outcome = await runBackup(id, { trigger: "manual", ...seams() });

    expect(outcome?.status).toBe("succeeded");
    expect([...cloud.files.keys()]).toEqual([nameAt(id, clock)]);

    const bytes = cloud.files.get(nameAt(id, clock)) ?? new Uint8Array();
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("Lisbon");
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("Dinner");

    const bundle = await openFile(key.identity);
    expect(bundle.balancia.backupVersion).toBe(1);
    expect(bundle.groups.map((entry) => entry.group.name)).toEqual([
      "Lisbon trip",
    ]);
    expect(bundle.groups[0]?.expenses.map((e) => e.description)).toEqual([
      "Dinner",
    ]);
    expect(bundle.groups[0]?.expenses[0]?.amount).toBe("4200");
  });

  it("cannot be opened with anybody else's key", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await runBackup(id, { trigger: "manual", ...seams() });

    const stranger = await createRecoveryKey();

    await expect(openFile(stranger.identity)).rejects.toThrow();
  });

  it("includes only groups the person owns", async () => {
    const { owner, key } = await setUp();
    const other = await createTestUser({ name: "Blaise" });
    await createTestGroup(owner, { name: "Mine" });
    const theirs = await createTestGroup(other, { name: "Blaise's" });
    // Amélie is a plain member of Blaise's group.
    const [participant] = [await addTestParticipant(theirs.groupId, "Amélie")];
    await getDb().insert(groupMembers).values({
      groupId: theirs.groupId,
      userId: owner.userId,
      participantId: participant,
      role: "member",
    });
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );

    await runBackup(id, { trigger: "manual", ...seams() });

    const bundle = await openFile(key.identity);
    expect(bundle.groups.map((entry) => entry.group.name)).toEqual(["Mine"]);
  });

  it("leaves out the groups the owner excluded, and keeps new ones in", async () => {
    const { owner, key } = await setUp();
    const keep = await createTestGroup(owner, { name: "Keep" });
    const skip = await createTestGroup(owner, { name: "Skip" });
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3, excludedGroupIds: [skip.groupId] },
      seams(),
    );
    await createTestGroup(owner, { name: "Made later" });

    await runBackup(id, { trigger: "manual", ...seams() });

    const names = (await openFile(key.identity)).groups.map(
      (entry) => entry.group.name,
    );
    expect(names.sort()).toEqual(["Keep", "Made later"]);
    expect(keep.groupId).toBeDefined();
  });

  it("records the run and moves the schedule on", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );

    await runBackup(id, { trigger: "schedule", ...seams() });

    const [view] = await listDestinations(owner.userId);
    expect(view?.lastSuccessAt).toEqual(clock);
    expect(view?.nextRunAt).toEqual(new Date("2026-10-10T03:30:00Z"));
    expect(view?.consecutiveFailures).toBe(0);
    expect(view?.latestRun).toMatchObject({
      status: "succeeded",
      groupCount: 1,
      objectName: nameAt(id, clock),
    });
    expect(view?.latestRun?.bytes).toBeGreaterThan(0);
  });

  it("writes nothing on a night when nothing changed", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await runBackup(id, { trigger: "schedule", ...seams() });

    clock = new Date("2026-10-10T03:30:00Z");
    const outcome = await runBackup(id, { trigger: "schedule", ...seams() });

    expect(outcome?.status).toBe("unchanged");
    expect(cloud.files.size).toBe(1);
    const [view] = await listDestinations(owner.userId);
    expect(view?.latestRun?.status).toBe("unchanged");
    // The copy on file is still the first one, and the weekly rewrite counts from it.
    expect(view?.lastSuccessAt).toEqual(new Date("2026-10-09T03:30:00Z"));
  });

  it("writes again the moment something changes", async () => {
    const { owner } = await setUp();
    const group = await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await runBackup(id, { trigger: "schedule", ...seams() });

    await expense(group);
    clock = new Date("2026-10-10T03:30:00Z");
    const outcome = await runBackup(id, { trigger: "schedule", ...seams() });

    expect(outcome?.status).toBe("succeeded");
    expect(cloud.files.size).toBe(2);
  });

  it("always writes when a person pressed the button", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await runBackup(id, { trigger: "schedule", ...seams() });

    clock = new Date("2026-10-09T09:00:00Z");
    const outcome = await runBackup(id, { trigger: "manual", ...seams() });

    expect(outcome?.status).toBe("succeeded");
    expect(cloud.files.size).toBe(2);
  });

  it("keeps the newest N and nothing of anyone else's", async () => {
    const { owner } = await setUp();
    const group = await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3, keepLast: 2 },
      seams(),
    );
    cloud.files.set("README.txt", new Uint8Array([1]));
    cloud.files.set(
      "balancia-backup-20200101T000000Z.json.gz.age.old",
      new Uint8Array([1]),
    );

    for (let day = 9; day <= 12; day += 1) {
      clock = new Date(`2026-10-${String(day).padStart(2, "0")}T03:30:00Z`);
      await expense(group, `Day ${day}`);
      await runBackup(id, { trigger: "schedule", ...seams() });
    }

    expect([...cloud.files.keys()].sort()).toEqual([
      "README.txt",
      "balancia-backup-20200101T000000Z.json.gz.age.old",
      nameAt(id, new Date("2026-10-11T03:30:00Z")),
      nameAt(id, new Date("2026-10-12T03:30:00Z")),
    ]);
  });

  it("keeps its own newest N in a folder another owner shares, and deletes none of theirs", async () => {
    // One fake cloud for both: two people who pointed their backups at the
    // same bucket and prefix.
    const ada = await setUp();
    const sam = await setUp();
    const adaGroup = await createTestGroup(ada.owner);
    const samGroup = await createTestGroup(sam.owner);
    const { id: adaId } = await createDestination(
      ada.owner.userId,
      { provider: "s3", credentials: S3, keepLast: 2 },
      seams(),
    );
    const { id: samId } = await createDestination(
      sam.owner.userId,
      { provider: "s3", credentials: S3, keepLast: 3 },
      seams(),
    );

    for (let day = 9; day <= 13; day += 1) {
      clock = new Date(`2026-10-${String(day).padStart(2, "0")}T03:30:00Z`);
      await expense(adaGroup, `Ada ${day}`);
      await expense(samGroup, `Sam ${day}`);
      // The same second, both of them: neither file may replace the other.
      await runBackup(adaId, { trigger: "schedule", ...seams() });
      await runBackup(samId, { trigger: "schedule", ...seams() });
    }

    expect([...cloud.files.keys()].sort()).toEqual(
      [
        nameAt(adaId, new Date("2026-10-12T03:30:00Z")),
        nameAt(adaId, new Date("2026-10-13T03:30:00Z")),
        nameAt(samId, new Date("2026-10-11T03:30:00Z")),
        nameAt(samId, new Date("2026-10-12T03:30:00Z")),
        nameAt(samId, new Date("2026-10-13T03:30:00Z")),
      ].sort(),
    );
    // And each file is still the one its owner's key opens.
    const adaBundle = await openFile(
      ada.key.identity,
      nameAt(adaId, new Date("2026-10-13T03:30:00Z")),
    );
    expect(adaBundle.groups.map((group) => group.group.id)).toEqual([
      adaGroup.groupId,
    ]);
  });

  it("deletes an untagged backup from before the change only when its own history says it wrote it", async () => {
    const { owner } = await setUp();
    const other = await setUp();
    const group = await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3, keepLast: 1 },
      seams(),
    );
    const { id: otherId } = await createDestination(
      other.owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );

    const mine = "balancia-backup-20261001T033000Z.json.gz.age";
    const nobodys = "balancia-backup-20261002T033000Z.json.gz.age";
    const theirs = "balancia-backup-20261003T033000Z.json.gz.age";
    // Written by both in the same second, back when that meant one file.
    const shared = "balancia-backup-20261004T033000Z.json.gz.age";
    for (const name of [mine, nobodys, theirs, shared]) {
      cloud.files.set(name, new Uint8Array([1]));
    }
    const ran = (destinationId: string, objectName: string) => ({
      destinationId,
      trigger: "schedule" as const,
      status: "succeeded" as const,
      startedAt: new Date("2026-10-01T03:30:00Z"),
      finishedAt: new Date("2026-10-01T03:31:00Z"),
      objectName,
    });
    await getDb()
      .insert(backupRuns)
      .values([
        ran(id, mine),
        ran(otherId, theirs),
        ran(id, shared),
        ran(otherId, shared),
      ]);

    await expense(group);
    const outcome = await runBackup(id, { trigger: "manual", ...seams() });

    expect(outcome?.deleted).toEqual([mine]);
    expect([...cloud.files.keys()].sort()).toEqual(
      [nobodys, theirs, shared, nameAt(id, clock)].sort(),
    );
  });

  it("does not lose the new copy if pruning the old ones fails", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3, keepLast: 1 },
      seams(),
    );
    await runBackup(id, { trigger: "schedule", ...seams() });
    cloud.remove = async () => {
      throw new BackupError("forbidden", "cannot delete");
    };

    clock = new Date("2026-10-10T03:30:00Z");
    const outcome = await runBackup(id, { trigger: "manual", ...seams() });

    expect(outcome?.status).toBe("succeeded");
    expect(cloud.files.size).toBe(2);
  });

  it("will not run twice at once", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await getDb()
      .insert(backupRuns)
      .values({
        destinationId: id,
        trigger: "manual",
        startedAt: new Date(clock.getTime() - 60_000),
      });

    expect(await runBackup(id, { trigger: "manual", ...seams() })).toBeNull();
    expect(cloud.files.size).toBe(0);
  });
});

describe("a backup that fails", () => {
  it("says why, counts it, and waits an hour before trying again", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    cloud.failWith = new BackupError("quota", "storageQuotaExceeded");
    // `check` ran when it was created; now only writes fail.
    cloud.check = async () => {};

    const outcome = await runBackup(id, { trigger: "schedule", ...seams() });

    expect(outcome).toMatchObject({ status: "failed", errorCode: "quota" });
    const [view] = await listDestinations(owner.userId);
    expect(view).toMatchObject({
      status: "active",
      consecutiveFailures: 1,
      attention: null,
      latestRun: {
        status: "failed",
        errorCode: "quota",
        errorDetail: "storageQuotaExceeded",
      },
    });
    expect(view?.nextRunAt).toEqual(new Date("2026-10-09T04:30:00Z"));
  });

  it("raises a flag after three in a row", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    cloud.failWith = new BackupError("unreachable", "no such host");
    cloud.check = async () => {};

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runBackup(id, { trigger: "manual", ...seams() });
      clock = new Date(clock.getTime() + 3_600_000);
    }

    expect((await listDestinations(owner.userId))[0]?.attention).toBe(
      "failing",
    );
  });

  it("stops the schedule when the provider says the access was taken back", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    cloud.failWith = new BackupError("reconnect", "invalid_grant");
    cloud.check = async () => {};

    await runBackup(id, { trigger: "schedule", ...seams() });

    const [view] = await listDestinations(owner.userId);
    expect(view).toMatchObject({
      status: "needs_reconnect",
      attention: "reconnect",
    });

    clock = new Date("2026-10-30T00:00:00Z");
    expect((await sweepDueBackups({ now: clock })).queued).toBe(0);
  });

  it("recovers by itself when a manual retry works", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    cloud.failWith = new BackupError("reconnect", "invalid_grant");
    cloud.check = async () => {};
    await runBackup(id, { trigger: "schedule", ...seams() });
    cloud.failWith = undefined;

    clock = new Date("2026-10-09T05:00:00Z");
    const outcome = await runBackup(id, { trigger: "manual", ...seams() });

    expect(outcome?.status).toBe("succeeded");
    expect((await listDestinations(owner.userId))[0]).toMatchObject({
      status: "active",
      consecutiveFailures: 0,
    });
  });

  it("explains an unreadable credential as a reason to reconnect", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await getDb()
      .update(backupDestinations)
      .set({ credentials: "v1.garbage.garbage" })
      .where(eq(backupDestinations.id, id));

    const outcome = await runBackup(id, { trigger: "schedule", ...seams() });

    expect(outcome).toMatchObject({ status: "failed", errorCode: "reconnect" });
  });

  it("will not open credentials copied from another destination", async () => {
    const { owner } = await setUp();
    const first = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    const second = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    const [source] = await getDb()
      .select({ credentials: backupDestinations.credentials })
      .from(backupDestinations)
      .where(eq(backupDestinations.id, first.id));
    await getDb()
      .update(backupDestinations)
      .set({ credentials: source?.credentials ?? "" })
      .where(eq(backupDestinations.id, second.id));

    const outcome = await runBackup(second.id, {
      trigger: "schedule",
      ...seams(),
    });

    expect(outcome).toMatchObject({ status: "failed", errorCode: "reconnect" });
  });

  it("is reported as lacking a key if the key is somehow gone", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await getDb().execute(`DELETE FROM backup_keys`);

    const outcome = await runBackup(id, { trigger: "schedule", ...seams() });

    expect(outcome).toMatchObject({ status: "failed", errorCode: "no_key" });
  });

  it("does not hand its failure to the queue to be retried at once", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    cloud.put = async () => {
      throw new Error("something nobody planned for");
    };

    await expect(
      runBackup(id, { trigger: "schedule", ...seams() }),
    ).resolves.toMatchObject({ status: "failed", errorCode: "unknown" });
  });
});

describe("what the person does while a run is going", () => {
  /** Makes the next upload wait for `during`, a quarter of an hour into the run. */
  function midway(during: () => Promise<void>, fail?: BackupError) {
    const put = cloud.put.bind(cloud);
    cloud.put = async (name, bytes) => {
      clock = new Date(clock.getTime() + 5 * 60_000);
      await during();
      clock = new Date(clock.getTime() + 10 * 60_000);
      if (fail) throw fail;
      await put(name, bytes);
    };
  }

  it("keeps a pause made while a run was going", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    midway(() =>
      updateDestination(owner.userId, id, { paused: true }, seams()),
    );

    const outcome = await runBackup(id, { trigger: "schedule", ...seams() });

    expect(outcome?.status).toBe("succeeded");
    const [view] = await listDestinations(owner.userId);
    expect(view?.status).toBe("paused");
    expect(view?.lastSuccessAt).toEqual(clock);
  });

  it("keeps a pause made while a failing run was going, rather than asking to reconnect", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    midway(
      () => updateDestination(owner.userId, id, { paused: true }, seams()),
      new BackupError("reconnect", "invalid_grant"),
    );

    const outcome = await runBackup(id, { trigger: "schedule", ...seams() });

    expect(outcome?.status).toBe("failed");
    const [view] = await listDestinations(owner.userId);
    expect(view?.status).toBe("paused");
    expect(view?.consecutiveFailures).toBe(1);
  });

  it("keeps a resume made during a manual run on a paused destination, and its run straight away", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await updateDestination(owner.userId, id, { paused: true }, seams());
    let resumedAt: Date | undefined;
    midway(async () => {
      resumedAt = clock;
      await updateDestination(owner.userId, id, { paused: false }, seams());
    });

    const outcome = await runBackup(id, { trigger: "manual", ...seams() });

    expect(outcome?.status).toBe("succeeded");
    const [view] = await listDestinations(owner.userId);
    expect(view?.status).toBe("active");
    expect(view?.nextRunAt).toEqual(resumedAt);
  });

  it("counts the next run from the schedule chosen while it went on", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3, frequency: "daily" },
      seams(),
    );
    midway(() =>
      updateDestination(owner.userId, id, { frequency: "weekly" }, seams()),
    );

    await runBackup(id, { trigger: "schedule", ...seams() });

    const [view] = await listDestinations(owner.userId);
    expect(view?.frequency).toBe("weekly");
    expect(view?.nextRunAt).toEqual(
      new Date(clock.getTime() + 7 * 24 * 60 * 60 * 1000),
    );
  });

  it("does not trip over a destination removed while it ran", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    midway(() => deleteDestination(owner.userId, id, seams()));

    // The run row goes with the destination; the run must still end quietly.
    await expect(
      runBackup(id, { trigger: "schedule", ...seams() }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(await listDestinations(owner.userId)).toEqual([]);
  });

  describe("a refresh token the provider rotates during the run", () => {
    async function sealedRefreshToken(id: string) {
      const [row] = await getDb()
        .select({ credentials: backupDestinations.credentials })
        .from(backupDestinations)
        .where(eq(backupDestinations.id, id));
      const plain = open("backup-destination", row?.credentials ?? null);
      return (
        JSON.parse(plain ?? "{}") as {
          credentials?: { refreshToken?: string };
        }
      ).credentials?.refreshToken;
    }

    async function driveDestination() {
      const { owner } = await setUp();
      await createTestGroup(owner);
      const { id } = await createDestination(
        owner.userId,
        { provider: "google_drive", credentials: { refreshToken: "rt-0" } },
        seams(),
      );
      return { owner, id };
    }

    it("is kept for the next run", async () => {
      const { id } = await driveDestination();

      await runBackup(id, {
        trigger: "schedule",
        ...seams(),
        openTransport: async (_provider, _credentials, options) => {
          await options?.onRefreshToken?.("rt-1");
          // A long run refreshes again before a later call, from the new one.
          await options?.onRefreshToken?.("rt-2");
          return cloud;
        },
      });

      expect(await sealedRefreshToken(id)).toBe("rt-2");
    });

    it("does not overwrite a reconnect made while the run went on", async () => {
      const { owner, id } = await driveDestination();

      await runBackup(id, {
        trigger: "schedule",
        ...seams(),
        openTransport: async (_provider, _credentials, options) => {
          await replaceCredentials(
            owner.userId,
            id,
            { refreshToken: "rt-reconnected" },
            seams(),
          );
          await options?.onRefreshToken?.("rt-1");
          return cloud;
        },
      });

      expect(await sealedRefreshToken(id)).toBe("rt-reconnected");
    });
  });
});

describe("the schedule", () => {
  it("queues exactly the destinations that are due", async () => {
    const { owner } = await setUp();
    const due = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    const later = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    const paused = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await getDb()
      .update(backupDestinations)
      .set({ nextRunAt: new Date(clock.getTime() + 3_600_000) })
      .where(eq(backupDestinations.id, later.id));
    await updateDestination(owner.userId, paused.id, { paused: true }, seams());

    const swept = await sweepDueBackups({ now: clock });

    expect(swept.queued).toBe(1);
    expect(published.jobs).toHaveLength(1);
    expect(published.jobs[0]).toMatchObject({
      queue: "backup.run",
      payload: { destinationId: due.id, trigger: "schedule" },
    });
  });

  it("does not queue the same destination twice while its run is open", async () => {
    const { owner } = await setUp();
    await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );

    await sweepDueBackups({ now: clock });
    await sweepDueBackups({ now: clock });

    expect(published.jobs).toHaveLength(1);
  });

  it("closes the run if it could not be queued, rather than leaving it 'running'", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    published.fail = true;

    const swept = await sweepDueBackups({ now: clock });

    expect(swept.queued).toBe(0);
    expect((await listRuns(owner.userId, id))[0]?.status).toBe("failed");
  });

  it("opens a manual run at once, and refuses a second", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );

    const first = await requestRun(owner.userId, id, seams());
    const second = await requestRun(owner.userId, id, seams());

    expect(first.status).toBe("queued");
    expect(second.status).toBe("already-running");
    expect((await listRuns(owner.userId, id))[0]?.status).toBe("running");
    expect(published.jobs).toHaveLength(1);
  });

  it("closes runs whose process died", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await getDb()
      .insert(backupRuns)
      .values({
        destinationId: id,
        trigger: "schedule",
        startedAt: new Date(clock.getTime() - 3 * 3_600_000),
      });

    expect(await reapStaleRuns(clock)).toBe(1);
    expect((await listRuns(owner.userId, id))[0]).toMatchObject({
      status: "failed",
      errorCode: "interrupted",
    });
  });

  it("counts a queued run's two hours from when a worker picks it up, not from when it was queued", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    const queued = await requestRun(owner.userId, id, seams());
    if (queued.status !== "queued") throw new Error("not queued");

    // A busy night: the worker reaches it an hour and a half later.
    clock = new Date(clock.getTime() + 90 * 60_000);
    const pickedUp = clock;
    const put = cloud.put.bind(cloud);
    let reaped = -1;
    cloud.put = async (name, bytes) => {
      // Forty minutes into the work, two hours and ten since it was queued.
      reaped = await reapStaleRuns(new Date(pickedUp.getTime() + 40 * 60_000));
      await put(name, bytes);
    };

    const outcome = await runBackup(id, {
      trigger: "manual",
      runId: queued.runId,
      ...seams(),
    });

    expect(reaped).toBe(0);
    expect(outcome?.status).toBe("succeeded");
    expect((await listRuns(owner.userId, id))[0]).toMatchObject({
      id: queued.runId,
      status: "succeeded",
      startedAt: pickedUp,
    });
  });

  it("does nothing with a job whose run was given up on while it waited", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    const queued = await requestRun(owner.userId, id, seams());
    if (queued.status !== "queued") throw new Error("not queued");
    clock = new Date(clock.getTime() + 2 * 3_600_000 + 60_000);
    // Reaps the run that never started, and queues its replacement.
    expect((await sweepDueBackups({ now: clock })).queued).toBe(1);

    // The worker reaches the old job at last.
    const outcome = await runBackup(id, {
      trigger: "manual",
      runId: queued.runId,
      ...seams(),
    });

    expect(outcome).toBeNull();
    expect(cloud.files.size).toBe(0);
    const runs = await listRuns(owner.userId, id);
    expect(runs.find((run) => run.id === queued.runId)).toMatchObject({
      status: "failed",
      errorCode: "interrupted",
    });
    // The replacement is left to its own job.
    expect(runs.filter((run) => run.status === "running")).toHaveLength(1);
    expect((await listDestinations(owner.userId))[0]?.lastRunAt).toBeNull();
  });

  it("closes the run it was in the middle of when the server stops, and the late finish does not reopen it", async () => {
    const { owner } = await setUp();
    await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    const put = cloud.put.bind(cloud);
    let closedByStop = -1;
    cloud.put = async (name, bytes) => {
      // The queue has stopped and given up on this job; the upload, already
      // under way, carries on for a moment.
      closedByStop = await closeRunsInHand(clock);
      await put(name, bytes);
    };

    await runBackup(id, { trigger: "schedule", ...seams() });

    expect(closedByStop).toBe(1);
    expect((await listRuns(owner.userId, id))[0]).toMatchObject({
      status: "failed",
      errorCode: "interrupted",
    });
    // Not the destination's fault, and not its success either: nothing is
    // counted, and the run that was due is still due.
    const [view] = await listDestinations(owner.userId);
    expect(view).toMatchObject({
      lastSuccessAt: null,
      consecutiveFailures: 0,
      status: "active",
    });
    expect(await closeRunsInHand(clock)).toBe(0);
    expect((await sweepDueBackups({ now: clock })).queued).toBe(1);
  });

  it("resumes a paused destination straight away", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await updateDestination(owner.userId, id, { paused: true }, seams());
    expect((await listDestinations(owner.userId))[0]?.status).toBe("paused");

    clock = new Date("2026-10-20T10:00:00Z");
    await updateDestination(owner.userId, id, { paused: false }, seams());

    expect((await listDestinations(owner.userId))[0]).toMatchObject({
      status: "active",
      nextRunAt: clock,
    });
  });

  it("keeps the thirty newest runs however old, and drops old ones beyond that", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    const rows = Array.from({ length: 40 }, (_, index) => ({
      destinationId: id,
      trigger: "schedule" as const,
      status: "succeeded" as const,
      startedAt: new Date(Date.UTC(2026, 0, 1 + index)),
    }));
    await getDb().insert(backupRuns).values(rows);

    const removed = await pruneRuns(new Date("2026-12-31T00:00:00Z"));

    expect(removed).toBe(10);
    expect(await listRuns(owner.userId, id, { limit: 100 })).toHaveLength(30);
  });
});

describe("finishing the wizard", () => {
  async function waiting() {
    const { owner, key } = await setUp();
    const group = await createTestGroup(owner, { name: "Lisbon trip" });
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3, draft: true },
      seams(),
    );
    return { owner, key, group, id };
  }

  const choices = {
    frequency: "weekly" as const,
    keepLast: 5,
    excludedGroupIds: [] as string[],
    includeReceipts: false,
  };

  it("keeps a waiting connection out of the schedule", async () => {
    const { owner } = await waiting();

    expect((await listDestinations(owner.userId))[0]?.status).toBe("setup");
    expect((await sweepDueBackups({ now: clock })).queued).toBe(0);
  });

  it("turns it into a destination that runs, with the choices made", async () => {
    const { owner, id, group } = await waiting();

    await finishSetup(
      owner.userId,
      id,
      { ...choices, excludedGroupIds: [group.groupId] },
      seams(),
    );

    expect((await listDestinations(owner.userId))[0]).toMatchObject({
      status: "active",
      frequency: "weekly",
      keepLast: 5,
      excludedGroupIds: [group.groupId],
      includeReceipts: false,
      nextRunAt: clock,
    });
    expect((await sweepDueBackups({ now: clock })).queued).toBe(1);
  });

  it("will not reset a destination that is already running", async () => {
    const { owner, id } = await waiting();
    await finishSetup(owner.userId, id, choices, seams());

    await expect(
      finishSetup(owner.userId, id, { ...choices, keepLast: 99 }, seams()),
    ).rejects.toMatchObject({ code: "notFound" });
    expect((await listDestinations(owner.userId))[0]?.keepLast).toBe(5);
  });

  it("is closed to everybody else", async () => {
    const { id } = await waiting();
    const stranger = await createTestUser();

    await expect(
      finishSetup(stranger.userId, id, choices, seams()),
    ).rejects.toMatchObject({ code: "notFound" });
  });

  it("lets a connection that nobody finished go after a day, and no sooner", async () => {
    const { owner } = await waiting();

    expect(
      await reapStaleSetups(new Date(clock.getTime() + 23 * 3_600_000)),
    ).toBe(0);
    expect(
      await reapStaleSetups(new Date(clock.getTime() + 25 * 3_600_000)),
    ).toBe(1);
    expect(await listDestinations(owner.userId)).toEqual([]);
  });

  it("does not let a waiting connection count against the limit of five", async () => {
    const { owner } = await setUp();
    for (let index = 0; index < 5; index += 1) {
      await createDestination(
        owner.userId,
        { provider: "s3", credentials: S3 },
        seams(),
      );
    }

    await expect(
      createDestination(
        owner.userId,
        { provider: "s3", credentials: S3, draft: true },
        seams(),
      ),
    ).rejects.toMatchObject({ code: "tooMany" });
  });
});

describe("switching receipts on", () => {
  it("starts them at once rather than tomorrow", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await runBackup(id, { trigger: "manual", ...seams() });
    clock = new Date("2026-10-09T10:00:00Z");

    await updateDestination(
      owner.userId,
      id,
      { includeReceipts: true },
      seams(),
    );

    expect((await listDestinations(owner.userId))[0]).toMatchObject({
      includeReceipts: true,
      nextRunAt: clock,
    });
  });

  it("leaves the schedule alone when they are switched off", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3, includeReceipts: true },
      seams(),
    );
    await runBackup(id, { trigger: "manual", ...seams() });
    const [before] = await listDestinations(owner.userId);
    clock = new Date("2026-10-09T10:00:00Z");

    await updateDestination(
      owner.userId,
      id,
      { includeReceipts: false },
      seams(),
    );

    expect((await listDestinations(owner.userId))[0]?.nextRunAt).toEqual(
      before?.nextRunAt,
    );
  });
});

describe("reading backups back", () => {
  it("lists only the backups this feature wrote, newest first", async () => {
    const { owner } = await setUp();
    const group = await createTestGroup(owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await runBackup(id, { trigger: "manual", ...seams() });
    await expense(group);
    clock = new Date("2026-10-10T03:30:00Z");
    await runBackup(id, { trigger: "manual", ...seams() });
    cloud.files.set("README.txt", new Uint8Array([1]));
    cloud.files.set("photos.zip", new Uint8Array([1]));

    const files = await listBackupFiles(owner.userId, id, seams());

    expect(files.map((file) => file.name)).toEqual([
      nameAt(id, new Date("2026-10-10T03:30:00Z")),
      nameAt(id, new Date("2026-10-09T03:30:00Z")),
    ]);
    expect(files[0]?.takenAt).toEqual(new Date("2026-10-10T03:30:00Z"));
  });

  it("offers neither another owner's backups in a shared folder nor a way to read them", async () => {
    const { owner } = await setUp();
    const other = await setUp();
    await createTestGroup(owner);
    await createTestGroup(other.owner);
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    const { id: otherId } = await createDestination(
      other.owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await runBackup(id, { trigger: "manual", ...seams() });
    await runBackup(otherId, { trigger: "manual", ...seams() });
    const legacy = "balancia-backup-20261001T033000Z.json.gz.age";
    cloud.files.set(legacy, new Uint8Array([1]));

    const files = await listBackupFiles(owner.userId, id, seams());

    // Its own, and the untagged one from before names said whose they were.
    expect(files.map((file) => file.name)).toEqual([nameAt(id, clock), legacy]);
    await expect(
      readBackupFile(owner.userId, id, nameAt(otherId, clock), seams()),
    ).rejects.toMatchObject({ code: "notFound" });
  });

  it("hands back the ciphertext the worker wrote, byte for byte", async () => {
    const { owner, key } = await setUp();
    await createTestGroup(owner, { name: "Flat" });
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await runBackup(id, { trigger: "manual", ...seams() });
    const name = nameAt(id, clock);

    const bytes = await readBackupFile(owner.userId, id, name, seams());

    expect(
      Buffer.from(bytes).equals(Buffer.from(cloud.files.get(name) ?? [])),
    ).toBe(true);
    // And it is the owner's key, here and nowhere on the server, that opens it.
    const opened = await decryptWith(key.identity, bytes);
    expect(gunzipSync(opened).toString("utf8")).toContain("Flat");
  });

  it("will not read a file that is not one of ours", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    cloud.files.set("README.txt", new Uint8Array([1]));

    for (const name of [
      "README.txt",
      "../secrets.txt",
      "balancia-backup-x.json.gz.age",
      "",
    ]) {
      await expect(
        readBackupFile(owner.userId, id, name, seams()),
      ).rejects.toMatchObject({ code: "notFound" });
    }
  });

  it("is closed to everybody but the owner of the destination", async () => {
    const { owner } = await setUp();
    const stranger = await createTestUser();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await createTestGroup(owner);
    await runBackup(id, { trigger: "manual", ...seams() });

    await expect(
      listBackupFiles(stranger.userId, id, seams()),
    ).rejects.toMatchObject({
      code: "notFound",
    });
    await expect(
      readBackupFile(stranger.userId, id, nameAt(id, clock), seams()),
    ).rejects.toMatchObject({ code: "notFound" });
  });
});

describe("account deletion", () => {
  it("takes the destinations, runs and key with it", async () => {
    const { owner } = await setUp();
    const { id } = await createDestination(
      owner.userId,
      { provider: "s3", credentials: S3 },
      seams(),
    );
    await runBackup(id, { trigger: "manual", ...seams() });

    await getDb().delete(users).where(eq(users.id, owner.userId));

    expect(await getDb().select().from(backupDestinations)).toEqual([]);
    expect(await getDb().select().from(backupRuns)).toEqual([]);
    expect(await getBackupKey(owner.userId)).toBeNull();
  });
});
