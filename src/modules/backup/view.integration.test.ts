import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { backupDestinations, groupMembers } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../../../tests/helpers/factories";
import { createRecoveryKey } from "./age";
import { BackupError } from "./errors";
import {
  createDestination,
  runBackup,
  saveBackupKey,
  updateDestination,
  type Seams,
} from "./service";
import type { BackupTransport } from "./transport";
import { loadBackupScreen, loadBackupSummary, providerTiles } from "./view";

/**
 * What the screen is told, and what the settings hub's one line says.
 */

const transport: BackupTransport & { failWith?: BackupError } = {
  async check() {},
  async ensureDirectory() {},
  async put() {
    if (transport.failWith) throw transport.failWith;
  },
  async list() {
    return [];
  },
  async remove() {},
  async read() {
    return Buffer.alloc(0);
  },
};
const seams: Seams = { openTransport: async () => transport };

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
  transport.failWith = undefined;
});

afterEach(() => {
  for (const name of [
    "BACKUP_GOOGLE_CLIENT_ID",
    "BACKUP_GOOGLE_CLIENT_SECRET",
    "BACKUP_EXPERIMENTAL_PROVIDERS",
  ]) {
    delete process.env[name];
  }
  resetEnvCache();
});

describe("which providers are offered", () => {
  it("offers the three account providers on a server that registered no app, for people to bring their own", () => {
    const tiles = Object.fromEntries(
      providerTiles().map((tile) => [
        tile.id,
        [tile.availability, tile.instanceApp],
      ]),
    );

    expect(tiles).toMatchObject({
      google_drive: ["available", false],
      dropbox: ["available", false],
      onedrive: ["available", false],
      s3: ["available", false],
      webdav: ["available", false],
    });
  });

  it("gives Google a single button once the operator has registered an app for it, and only Google", () => {
    process.env.BACKUP_GOOGLE_CLIENT_ID = "id";
    process.env.BACKUP_GOOGLE_CLIENT_SECRET = "secret";
    resetEnvCache();

    const tiles = providerTiles();
    expect(tiles.find((tile) => tile.id === "google_drive")).toMatchObject({
      availability: "available",
      instanceApp: true,
    });
    expect(tiles.find((tile) => tile.id === "dropbox")?.instanceApp).toBe(
      false,
    );
  });

  it("names this server's redirect address for each account provider, and none for the others", () => {
    const addresses = Object.fromEntries(
      providerTiles().map((tile) => [tile.id, tile.redirectUri]),
    );

    expect(addresses.google_drive).toMatch(
      /^https?:\/\/[^/]+\/api\/backup\/oauth\/google\/callback$/,
    );
    expect(addresses.dropbox).toMatch(
      /\/api\/backup\/oauth\/dropbox\/callback$/,
    );
    expect(addresses.onedrive).toMatch(
      /\/api\/backup\/oauth\/microsoft\/callback$/,
    );
    expect(addresses.s3).toBeNull();
    expect(addresses.webdav).toBeNull();
  });

  it("draws Proton Drive disabled until the operator opts in", () => {
    const off = providerTiles().filter((tile) => tile.experimental);
    expect(off.map((tile) => [tile.id, tile.availability])).toEqual([
      ["proton_drive", "experimental_off"],
    ]);

    process.env.BACKUP_EXPERIMENTAL_PROVIDERS = "true";
    resetEnvCache();

    expect(
      providerTiles()
        .filter((tile) => tile.experimental)
        .map((tile) => tile.availability),
    ).toEqual(["available"]);
  });

  it("does not offer iCloud Drive at all, whatever the operator sets", () => {
    process.env.BACKUP_EXPERIMENTAL_PROVIDERS = "true";
    resetEnvCache();

    expect(providerTiles().map((tile) => tile.id)).not.toContain(
      "icloud_drive",
    );
  });
});

describe("the backup screen", () => {
  it("offers only the groups this person owns", async () => {
    const owner = await createTestUser({ name: "Amélie" });
    const other = await createTestUser({ name: "Blaise" });
    await createTestGroup(owner, { name: "Mine" });
    const theirs = await createTestGroup(other, { name: "Blaise's" });
    const seat = await addTestParticipant(theirs.groupId, "Amélie");
    await getDb().insert(groupMembers).values({
      groupId: theirs.groupId,
      userId: owner.userId,
      participantId: seat,
      role: "member",
    });

    const screen = await loadBackupScreen(owner.userId);

    expect(screen.ownedGroups.map((group) => group.name)).toEqual(["Mine"]);
    expect(screen.ownedGroups[0]?.participantCount).toBe(1);
  });

  it("starts empty: no key, no destination, receipts that cost nothing", async () => {
    const owner = await createTestUser();

    const screen = await loadBackupScreen(owner.userId);

    expect(screen).toMatchObject({
      key: null,
      destinations: [],
      canAddDestination: true,
      receipts: { count: 0, bytes: 0 },
      allowPrivateEndpoints: false,
    });
  });

  it("shows the key's fingerprint and never its recipient", async () => {
    const owner = await createTestUser();
    const { recipient } = await createRecoveryKey();
    await saveBackupKey(owner.userId, recipient);

    const screen = await loadBackupScreen(owner.userId);

    expect(screen.key?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(screen.key)).not.toContain(recipient);
  });

  it("stops offering new destinations at the limit", async () => {
    const owner = await createTestUser();
    await saveBackupKey(owner.userId, (await createRecoveryKey()).recipient);
    for (let index = 0; index < 5; index += 1) {
      await createDestination(
        owner.userId,
        { provider: "s3", credentials: S3 },
        seams,
      );
    }

    expect((await loadBackupScreen(owner.userId)).canAddDestination).toBe(
      false,
    );
  });
});

describe("the hub's one line", () => {
  async function owner() {
    const user = await createTestUser();
    await saveBackupKey(user.userId, (await createRecoveryKey()).recipient);
    await createTestGroup(user);
    return user;
  }

  it("says nothing is set up", async () => {
    const user = await createTestUser();

    expect(await loadBackupSummary(user.userId)).toEqual({ state: "none" });
  });

  it("says how often, and where", async () => {
    const user = await owner();
    await createDestination(
      user.userId,
      { provider: "s3", credentials: S3 },
      seams,
    );

    expect(await loadBackupSummary(user.userId)).toEqual({
      state: "on",
      frequency: "daily",
      labels: ["S3 · family-backups"],
    });
  });

  it("says when it is paused", async () => {
    const user = await owner();
    const { id } = await createDestination(
      user.userId,
      { provider: "s3", credentials: S3 },
      seams,
    );
    await updateDestination(user.userId, id, { paused: true }, seams);

    expect(await loadBackupSummary(user.userId)).toEqual({ state: "paused" });
  });

  it("raises a revoked connection above everything", async () => {
    const user = await owner();
    const { id } = await createDestination(
      user.userId,
      { provider: "s3", credentials: S3 },
      seams,
    );
    transport.failWith = new BackupError("reconnect", "invalid_grant");

    await runBackup(id, { trigger: "manual", ...seams });

    expect(await loadBackupSummary(user.userId)).toEqual({
      state: "attention",
      reason: "reconnect",
    });
  });

  it("raises a destination that keeps failing", async () => {
    const user = await owner();
    const { id } = await createDestination(
      user.userId,
      { provider: "s3", credentials: S3 },
      seams,
    );
    transport.failWith = new BackupError("quota", "full");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runBackup(id, { trigger: "manual", ...seams });
    }

    expect(await loadBackupSummary(user.userId)).toEqual({
      state: "attention",
      reason: "failing",
    });
    await getDb()
      .update(backupDestinations)
      .set({ consecutiveFailures: 0 })
      .where(eq(backupDestinations.id, id));
  });
});
