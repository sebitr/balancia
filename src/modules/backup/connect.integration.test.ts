import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { backupDestinations, backupRuns } from "@/lib/db/schema";
import { createTestUser } from "../../../tests/helpers/factories";
import { createRecoveryKey } from "./age";
import { completeConnection, type ConnectDeps } from "./connect";
import { BackupError } from "./errors";
import {
  createDestination,
  getDestinationApp,
  listDestinations,
  saveBackupKey,
  type Seams,
} from "./service";
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

  describe("through an app of the person's own", () => {
    const app = { clientId: "mine.apps.example", clientSecret: "my-secret-9" };

    it("trades the code as that app, and keeps it with the connection", async () => {
      const owner = await ownerWithKey();
      const exchangeCode = vi.fn(async () => ({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: new Date("2026-10-09T04:30:00Z"),
      }));
      const opened: unknown[] = [];

      await completeConnection(
        {
          userId: owner.userId,
          kind: "google",
          code: "c",
          verifier: "v",
          app,
        },
        {
          deps: { ...deps(), exchangeCode },
          openTransport: async (_provider, credentials) => {
            opened.push(credentials);
            return transport;
          },
        },
      );

      expect(exchangeCode).toHaveBeenCalledWith("google", {
        code: "c",
        verifier: "v",
        app,
      });
      // What a run will open the destination with: the token and the app it
      // was issued to, together.
      expect(opened).toEqual([
        { refreshToken: "refresh-1", account: "ada@gmail.com", app },
      ]);
    });

    it("keeps the secret sealed, not readable in the row", async () => {
      const owner = await ownerWithKey();
      const connected = await completeConnection(
        {
          userId: owner.userId,
          kind: "dropbox",
          code: "c",
          verifier: "v",
          app,
        },
        { ...seams(), deps: deps() },
      );

      const [row] = await getDb()
        .select({ credentials: backupDestinations.credentials })
        .from(backupDestinations)
        .where(eq(backupDestinations.id, connected.destinationId));

      expect(row?.credentials).not.toContain("my-secret-9");
      expect(row?.credentials).not.toContain("mine.apps.example");
    });

    it("hands the app back to a reconnect of that destination, and to nobody else", async () => {
      const owner = await ownerWithKey();
      const stranger = await ownerWithKey();
      const { id } = await createDestination(
        owner.userId,
        {
          provider: "google_drive",
          credentials: { refreshToken: "old", app },
        },
        seams(),
      );

      expect(await getDestinationApp(owner.userId, id, seams())).toEqual(app);
      await expect(
        getDestinationApp(stranger.userId, id, seams()),
      ).rejects.toMatchObject({ code: "notFound" });
    });

    it("has none to hand back for a destination made through the server's app", async () => {
      const owner = await ownerWithKey();
      const { id } = await createDestination(
        owner.userId,
        { provider: "google_drive", credentials: { refreshToken: "old" } },
        seams(),
      );

      expect(
        await getDestinationApp(owner.userId, id, seams()),
      ).toBeUndefined();
    });

    it("replaces the app on a reconnect, so a corrected secret takes over from the refused one", async () => {
      const owner = await ownerWithKey();
      const { id } = await createDestination(
        owner.userId,
        {
          provider: "google_drive",
          credentials: { refreshToken: "old", app },
        },
        seams(),
      );
      const corrected = {
        clientId: app.clientId,
        clientSecret: "fixed-secret",
      };

      await completeConnection(
        {
          userId: owner.userId,
          kind: "google",
          code: "c",
          verifier: "v",
          reconnectId: id,
          app: corrected,
        },
        { ...seams(), deps: deps() },
      );

      expect(await getDestinationApp(owner.userId, id, seams())).toEqual(
        corrected,
      );
    });
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
