import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { backupDestinations, backupRuns } from "@/lib/db/schema";
import { createTestUser } from "../../../tests/helpers/factories";
import { createRecoveryKey } from "./age";
import { completeConnection, type ConnectDeps } from "./connect";
import { BackupError } from "./errors";
import { listDestinations, saveBackupKey, type Seams } from "./service";
import type { BackupTransport } from "./transport";

/**
 * The step after the provider sends someone back.
 *
 * The provider calls are replaced with ones that answer the way the real ones
 * do; the database is real. What is being protected is what ends up stored and
 * for whom: a reconnect must never write into somebody else's destination, and
 * a connection that cannot write a file must not be kept.
 */

vi.mock("@/lib/jobs/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/queue")>()),
  publish: vi.fn(async () => "job-id"),
}));

const fakeTransport = (fail?: BackupError): BackupTransport => ({
  check: async () => {
    if (fail) throw fail;
  },
  ensureDirectory: async () => {},
  put: async () => {},
  list: async () => [],
  remove: async () => {},
  read: async () => Buffer.alloc(0),
});

let transport: BackupTransport;
const seams = (): Seams => ({ openTransport: async () => transport });

const deps = (account = "ada@gmail.com"): ConnectDeps => ({
  exchangeCode: vi.fn(async () => ({
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: new Date("2026-10-09T04:30:00Z"),
  })),
  describeAccount: vi.fn(async () => ({ account })),
});

beforeEach(() => {
  transport = fakeTransport();
});

async function ownerWithKey() {
  const owner = await createTestUser();
  await saveBackupKey(owner.userId, (await createRecoveryKey()).recipient);
  return owner;
}

describe("completing a connection", () => {
  it("keeps a new connection waiting for step 4, named for the account, with no backup yet", async () => {
    const owner = await ownerWithKey();

    const connected = await completeConnection(
      { userId: owner.userId, kind: "google", code: "c", verifier: "v" },
      { ...seams(), deps: deps() },
    );

    expect(connected.reconnected).toBe(false);
    const [view] = await listDestinations(owner.userId);
    expect(view).toMatchObject({
      id: connected.destinationId,
      provider: "google_drive",
      label: "Google Drive · ada@gmail.com",
      // Not yet a commitment: the person has not said which groups or how
      // often. Step 4 does, and only then does anything run.
      status: "setup",
      latestRun: null,
    });
  });

  it("replaces a connection left waiting from an earlier attempt rather than piling them up", async () => {
    const owner = await ownerWithKey();
    const first = await completeConnection(
      { userId: owner.userId, kind: "google", code: "c", verifier: "v" },
      { ...seams(), deps: deps("one@gmail.com") },
    );

    const second = await completeConnection(
      { userId: owner.userId, kind: "dropbox", code: "c", verifier: "v" },
      { ...seams(), deps: deps("two@example.com") },
    );

    const all = await listDestinations(owner.userId);
    expect(all.map((entry) => entry.id)).toEqual([second.destinationId]);
    expect(all.map((entry) => entry.id)).not.toContain(first.destinationId);
  });

  it("keeps the refresh token sealed", async () => {
    const owner = await ownerWithKey();
    const connected = await completeConnection(
      { userId: owner.userId, kind: "dropbox", code: "c", verifier: "v" },
      { ...seams(), deps: deps() },
    );

    const [row] = await getDb()
      .select({ credentials: backupDestinations.credentials })
      .from(backupDestinations)
      .where(eq(backupDestinations.id, connected.destinationId));

    expect(row?.credentials).not.toContain("refresh-1");
  });

  it("keeps OneDrive's app folder with it, because rclone needs to be told", async () => {
    const owner = await ownerWithKey();
    const describeAccount = vi.fn(async () => ({
      account: "ada@outlook.com",
      onedrive: {
        driveId: "b!drive",
        driveType: "personal" as const,
        rootFolderId: "ROOT",
      },
    }));

    const connected = await completeConnection(
      { userId: owner.userId, kind: "microsoft", code: "c", verifier: "v" },
      { ...seams(), deps: { ...deps(), describeAccount } },
    );

    expect(
      (await listDestinations(owner.userId)).find(
        (entry) => entry.id === connected.destinationId,
      )?.provider,
    ).toBe("onedrive");
  });

  it("does not keep a connection that cannot write a file", async () => {
    const owner = await ownerWithKey();
    transport = fakeTransport(new BackupError("forbidden", "AccessDenied"));

    await expect(
      completeConnection(
        { userId: owner.userId, kind: "google", code: "c", verifier: "v" },
        { ...seams(), deps: deps() },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await listDestinations(owner.userId)).toEqual([]);
  });

  it("will not connect for someone with no recovery key", async () => {
    const owner = await createTestUser();

    await expect(
      completeConnection(
        { userId: owner.userId, kind: "google", code: "c", verifier: "v" },
        { ...seams(), deps: deps() },
      ),
    ).rejects.toMatchObject({ code: "noKey" });
  });
});

describe("reconnecting", () => {
  async function connected() {
    const owner = await ownerWithKey();
    const first = await completeConnection(
      { userId: owner.userId, kind: "google", code: "c", verifier: "v" },
      { ...seams(), deps: deps("old@gmail.com") },
    );
    await getDb()
      .update(backupDestinations)
      .set({ status: "needs_reconnect", consecutiveFailures: 4 })
      .where(eq(backupDestinations.id, first.destinationId));
    await getDb().delete(backupRuns);
    return { owner, id: first.destinationId };
  }

  it("replaces the credentials and puts the schedule back", async () => {
    const { owner, id } = await connected();

    const result = await completeConnection(
      {
        userId: owner.userId,
        kind: "google",
        code: "c2",
        verifier: "v2",
        reconnectId: id,
      },
      { ...seams(), deps: deps("new@gmail.com") },
    );

    expect(result).toEqual({ destinationId: id, reconnected: true });
    const [view] = await listDestinations(owner.userId);
    expect(view).toMatchObject({
      id,
      status: "active",
      consecutiveFailures: 0,
    });
    expect(await listDestinations(owner.userId)).toHaveLength(1);
  });

  it("will not touch somebody else's destination", async () => {
    const { id } = await connected();
    const stranger = await ownerWithKey();
    const exchange = deps();

    await expect(
      completeConnection(
        {
          userId: stranger.userId,
          kind: "google",
          code: "c",
          verifier: "v",
          reconnectId: id,
        },
        { ...seams(), deps: exchange },
      ),
    ).rejects.toMatchObject({ code: "notFound" });
    // Refused before the code was spent.
    expect(exchange.exchangeCode).not.toHaveBeenCalled();
  });

  it("will not pour a Dropbox token into a Google Drive destination", async () => {
    const { owner, id } = await connected();
    const exchange = deps();

    await expect(
      completeConnection(
        {
          userId: owner.userId,
          kind: "dropbox",
          code: "c",
          verifier: "v",
          reconnectId: id,
        },
        { ...seams(), deps: exchange },
      ),
    ).rejects.toBeInstanceOf(BackupError);
    expect(exchange.exchangeCode).not.toHaveBeenCalled();
  });
});
