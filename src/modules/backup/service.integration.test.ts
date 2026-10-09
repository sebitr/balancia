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
import { bundleName } from "./naming";
import {
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
    expect([...cloud.files.keys()]).toEqual([bundleName(clock)]);

    const bytes = cloud.files.get(bundleName(clock)) ?? new Uint8Array();
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
      objectName: bundleName(clock),
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
      "balancia-backup-20261011T033000Z.json.gz.age",
      "balancia-backup-20261012T033000Z.json.gz.age",
    ]);
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
      errorCode: "unknown",
    });
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
      "balancia-backup-20261010T033000Z.json.gz.age",
      "balancia-backup-20261009T033000Z.json.gz.age",
    ]);
    expect(files[0]?.takenAt).toEqual(new Date("2026-10-10T03:30:00Z"));
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
    const name = bundleName(clock);

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
      readBackupFile(stranger.userId, id, bundleName(clock), seams()),
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
