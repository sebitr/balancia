import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { createTestUser } from "../../../tests/helpers/factories";
import { createRecoveryKey } from "./age";
import { beginConnection } from "./begin";
import { challengeFor } from "./oauth";
import { createDestination, saveBackupKey, type Seams } from "./service";
import type { BackupTransport } from "./transport";

/**
 * Setting out for the provider.
 *
 * The question this answers is "which app, and is it the person's to use": a
 * pasted one, the one a reconnect was made through, the server's, or none —
 * and, whichever it is, that a trip only starts for someone who has a key to
 * encrypt to and, on a reconnect, a destination of their own.
 */

vi.mock("@/lib/jobs/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/queue")>()),
  publish: vi.fn(async () => "job-id"),
}));

const transport: BackupTransport = {
  check: async () => {},
  ensureDirectory: async () => {},
  put: async () => {},
  list: async () => [],
  remove: async () => {},
  read: async () => Buffer.alloc(0),
};
const seams: Seams = { openTransport: async () => transport };

const OWN = { clientId: "mine.apps.example", clientSecret: "my-secret-9" };

beforeEach(() => {
  for (const name of ["GOOGLE", "DROPBOX", "MICROSOFT"]) {
    delete process.env[`BACKUP_${name}_CLIENT_ID`];
    delete process.env[`BACKUP_${name}_CLIENT_SECRET`];
  }
  resetEnvCache();
});

afterEach(() => {
  for (const name of ["GOOGLE", "DROPBOX", "MICROSOFT"]) {
    delete process.env[`BACKUP_${name}_CLIENT_ID`];
    delete process.env[`BACKUP_${name}_CLIENT_SECRET`];
  }
  resetEnvCache();
});

async function ownerWithKey() {
  const owner = await createTestUser();
  await saveBackupKey(owner.userId, (await createRecoveryKey()).recipient);
  return owner;
}

describe("beginning a connection", () => {
  it("goes to the provider as the app the person pasted, on a server that registered none", async () => {
    const owner = await ownerWithKey();

    const { url, pending } = await beginConnection({
      userId: owner.userId,
      kind: "google",
      app: OWN,
    });

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("mine.apps.example");
    expect(pending.app).toEqual(OWN);
    expect(pending.userId).toBe(owner.userId);
  });

  it("never lets the secret near the address", async () => {
    const owner = await ownerWithKey();

    const { url } = await beginConnection({
      userId: owner.userId,
      kind: "dropbox",
      app: OWN,
    });

    expect(url.toString()).not.toContain("my-secret-9");
  });

  it("binds the way back to this attempt with a state and a challenge of its own", async () => {
    const owner = await ownerWithKey();

    const first = await beginConnection({
      userId: owner.userId,
      kind: "google",
      app: OWN,
    });
    const second = await beginConnection({
      userId: owner.userId,
      kind: "google",
      app: OWN,
    });

    expect(first.pending.state).not.toBe(second.pending.state);
    expect(first.url.searchParams.get("state")).toBe(first.pending.state);
    expect(first.url.searchParams.get("code_challenge")).toBe(
      challengeFor(first.pending.verifier),
    );
  });

  it("uses the server's app when the person pasted none and the server has one", async () => {
    process.env.BACKUP_GOOGLE_CLIENT_ID = "server-id";
    process.env.BACKUP_GOOGLE_CLIENT_SECRET = "server-secret";
    resetEnvCache();
    const owner = await ownerWithKey();

    const { url, pending } = await beginConnection({
      userId: owner.userId,
      kind: "google",
    });

    expect(url.searchParams.get("client_id")).toBe("server-id");
    // The server's secret belongs to the server: it is not copied into a cookie.
    expect(pending.app).toBeUndefined();
  });

  it("refuses, before sending anyone anywhere, when there is no app at all", async () => {
    const owner = await ownerWithKey();

    await expect(
      beginConnection({ userId: owner.userId, kind: "microsoft" }),
    ).rejects.toMatchObject({ code: "app" });
  });

  it("refuses a person with no recovery key, because their first backup could not be encrypted", async () => {
    const owner = await createTestUser();

    await expect(
      beginConnection({ userId: owner.userId, kind: "google", app: OWN }),
    ).rejects.toMatchObject({ code: "noKey" });
  });

  describe("a reconnect", () => {
    it("goes back through the app the destination was connected with", async () => {
      const owner = await ownerWithKey();
      const { id } = await createDestination(
        owner.userId,
        {
          provider: "google_drive",
          credentials: { refreshToken: "old", app: OWN },
        },
        seams,
      );

      const { url, pending } = await beginConnection(
        { userId: owner.userId, kind: "google", reconnectId: id },
        seams,
      );

      expect(url.searchParams.get("client_id")).toBe("mine.apps.example");
      expect(pending.app).toEqual(OWN);
      expect(pending.reconnectId).toBe(id);
    });

    it("takes new details over the old, which is how a refused secret gets mended", async () => {
      const owner = await ownerWithKey();
      const { id } = await createDestination(
        owner.userId,
        {
          provider: "google_drive",
          credentials: { refreshToken: "old", app: OWN },
        },
        seams,
      );
      const fixed = { clientId: OWN.clientId, clientSecret: "fixed-secret" };

      const { pending } = await beginConnection(
        { userId: owner.userId, kind: "google", reconnectId: id, app: fixed },
        seams,
      );

      expect(pending.app).toEqual(fixed);
    });

    it("answers a destination that belongs to somebody else as one that is not there", async () => {
      const owner = await ownerWithKey();
      const stranger = await ownerWithKey();
      const { id } = await createDestination(
        owner.userId,
        {
          provider: "google_drive",
          credentials: { refreshToken: "old", app: OWN },
        },
        seams,
      );

      await expect(
        beginConnection(
          { userId: stranger.userId, kind: "google", reconnectId: id },
          seams,
        ),
      ).rejects.toMatchObject({ code: "notFound" });
    });
  });
});
