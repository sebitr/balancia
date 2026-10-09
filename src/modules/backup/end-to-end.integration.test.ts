import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { createExpense } from "@/modules/expenses/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../../../tests/helpers/factories";
import { createRecoveryKey, decryptWith } from "./age";
import type { BackupBundle } from "./bundle";
import {
  createDestination,
  listBackupFiles,
  listDestinations,
  readBackupFile,
  runBackup,
  saveBackupKey,
} from "./service";

/**
 * The whole path, with nothing replaced.
 *
 * A real account and group in PostgreSQL, the real service sealing real
 * credentials, the real `rclone` writing over WebDAV to a server rclone itself
 * serves, and the file read back off the disk that server writes to and opened
 * with the recovery key. The other suites each prove a layer by faking its
 * neighbours; this one is the check that the layers fit.
 *
 * Skipped without an `rclone` on the machine, like the transport suite. CI
 * installs one.
 */

vi.mock("@/lib/jobs/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/queue")>()),
  publish: vi.fn(async () => "job-id"),
}));

const HAVE_RCLONE = spawnSync("rclone", ["version"]).status === 0;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

async function waitForPort(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`nothing listened on ${port}`);
}

let root: string;
let served: string;
let server: ChildProcess | undefined;
let port: number;

beforeAll(async () => {
  if (!HAVE_RCLONE) return;
  // Local addresses are refused unless the operator allows them; a test server
  // on 127.0.0.1 is exactly the operator who does.
  process.env.BACKUP_ALLOW_PRIVATE_ENDPOINTS = "true";
  resetEnvCache();
  root = await mkdtemp(join(tmpdir(), "balancia-e2e-"));
  served = join(root, "dav");
  await mkdir(served);
  port = await freePort();
  server = spawn(
    "rclone",
    [
      "serve",
      "webdav",
      served,
      "--addr",
      `127.0.0.1:${port}`,
      "--user",
      "ada",
      "--pass",
      "a-long-app-password",
    ],
    { stdio: "ignore" },
  );
  await waitForPort(port);
});

afterAll(async () => {
  server?.kill("SIGKILL");
  delete process.env.BACKUP_ALLOW_PRIVATE_ENDPOINTS;
  resetEnvCache();
  if (root) await rm(root, { recursive: true, force: true });
});

describe.skipIf(!HAVE_RCLONE)("a backup, end to end", () => {
  it("lands as ciphertext on a real WebDAV server and opens with the owner's key", async () => {
    const owner = await createTestUser({ name: "Amélie" });
    const key = await createRecoveryKey();
    await saveBackupKey(owner.userId, key.recipient);
    const group = await createTestGroup(owner, { name: "Lisbon trip" });
    const guest = await addTestParticipant(group.groupId, "Blaise");
    await createExpense(group.access, {
      description: "Pastéis de nata",
      notes: "",
      category: "Food",
      amount: "1250",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "1250" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: guest },
      ],
    });

    // The real service, the real transport: the connection is proved to work
    // before it is kept, by writing and deleting a file on the real server.
    const { id } = await createDestination(owner.userId, {
      provider: "webdav",
      credentials: {
        url: `http://127.0.0.1:${port}`,
        vendor: "other",
        username: "ada",
        password: "a-long-app-password",
        folder: "family",
      },
    });

    const outcome = await runBackup(id, { trigger: "manual" });

    expect(outcome).toMatchObject({ status: "succeeded" });
    const folder = join(served, "family", "Balancia Backups");
    const names = await readdir(folder);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^balancia-backup-\d{8}T\d{6}Z\.json\.gz\.age$/);

    // What is on the server's disk is ciphertext...
    const onDisk = await readFile(join(folder, names[0] ?? ""));
    expect(onDisk.toString("latin1")).not.toContain("Lisbon");
    expect(onDisk.toString("latin1")).not.toContain("Pastéis");

    // ...which only the owner's key turns back into their groups.
    const bundle = JSON.parse(
      gunzipSync(await decryptWith(key.identity, onDisk)).toString("utf8"),
    ) as BackupBundle;
    expect(bundle.groups.map((entry) => entry.group.name)).toEqual([
      "Lisbon trip",
    ]);
    expect(bundle.groups[0]?.expenses[0]?.description).toBe("Pastéis de nata");
    expect(bundle.groups[0]?.expenses[0]?.amount).toBe("1250");

    // The screen's view of it, and the restore screen's read-back path.
    const [view] = await listDestinations(owner.userId);
    expect(view).toMatchObject({
      status: "active",
      label: "WebDAV · 127.0.0.1:" + port,
      latestRun: { status: "succeeded", groupCount: 1, objectName: names[0] },
    });
    const files = await listBackupFiles(owner.userId, id);
    expect(files.map((file) => file.name)).toEqual(names);
    const readBack = await readBackupFile(owner.userId, id, names[0] ?? "");
    expect(Buffer.from(readBack).equals(onDisk)).toBe(true);
  });

  it("leaves nothing but backups behind: the connection test cleaned up after itself", async () => {
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else files.push(full);
      }
    };
    await walk(served);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // The connection test's file was deleted; only backups remain.
      expect(file).toMatch(/balancia-backup-.*\.json\.gz\.age$/);
    }
  });
});
