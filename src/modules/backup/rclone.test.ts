import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { BackupError } from "./errors";
import { buildRemote } from "./rclone-config";
import {
  checkConnection,
  deleteObject,
  ensureDirectory,
  listObjects,
  obscure,
  putObject,
  rcloneAvailable,
  readObject,
} from "./rclone";

/**
 * The transport, against a real rclone and a real server.
 *
 * rclone can serve what it also reads — `serve webdav`, `serve s3` — so these
 * run the actual binary against actual protocols on localhost, with no
 * account and no network. They are skipped on a machine without rclone rather
 * than failing it: the unit of work is the code in this repository, and the
 * binary is the one dependency it does not own. The image carries it, and the
 * CI job that builds the image is where its absence would show.
 */

const HAVE_RCLONE = spawnSync("rclone", ["version"]).status === 0;
// `serve s3` arrived in rclone 1.65; a distribution's older package has WebDAV
// and not this, and the S3 half of the suite should skip there, not fail.
const CAN_SERVE_S3 =
  HAVE_RCLONE && spawnSync("rclone", ["serve", "s3", "--help"]).status === 0;

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
const servers: ChildProcess[] = [];

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
  process.env.DATABASE_URL = "postgres://balancia:pw@localhost:5432/balancia";
  process.env.APP_URL = "https://balancia.example.com";
  resetEnvCache();
  root = await mkdtemp(join(tmpdir(), "balancia-served-"));
});

afterAll(async () => {
  for (const server of servers) server.kill("SIGKILL");
  await rm(root, { recursive: true, force: true });
});

function serve(args: string[]): void {
  servers.push(spawn("rclone", args, { stdio: "ignore" }));
}

describe.skipIf(!HAVE_RCLONE)("rclone over WebDAV", () => {
  let port: number;
  let directory: string;

  beforeAll(async () => {
    port = await freePort();
    directory = join(root, "dav");
    await mkdir(directory);
    serve([
      "serve",
      "webdav",
      directory,
      "--addr",
      `127.0.0.1:${port}`,
      "--user",
      "ada",
      "--pass",
      "correct horse battery",
    ]);
    await waitForPort(port);
  });

  const credentials = (overrides: Record<string, unknown> = {}) => ({
    url: `http://127.0.0.1:${port}`,
    vendor: "other",
    username: "ada",
    password: "correct horse battery",
    folder: "",
    ...overrides,
  });

  const remote = (overrides: Record<string, unknown> = {}) =>
    buildRemote("webdav", credentials(overrides), { obscure });

  it("is found on this machine", async () => {
    expect(await rcloneAvailable()).toBe(true);
  });

  it("proves a destination works by writing, seeing and removing a file", async () => {
    await expect(checkConnection(await remote())).resolves.toBeUndefined();

    expect(await readdir(join(directory, "Balancia Backups"))).toEqual([]);
  });

  it("writes a file, lists it, reads it back byte for byte, and deletes it", async () => {
    const target = await remote();
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    await ensureDirectory(target);

    await putObject(
      target,
      "balancia-backup-20261009T033012Z.json.gz.age",
      bytes,
    );

    expect(await listObjects(target)).toEqual([
      "balancia-backup-20261009T033012Z.json.gz.age",
    ]);
    expect(
      Buffer.from(
        await readObject(
          target,
          "balancia-backup-20261009T033012Z.json.gz.age",
        ),
      ).equals(Buffer.from(bytes)),
    ).toBe(true);

    await deleteObject(target, "balancia-backup-20261009T033012Z.json.gz.age");
    expect(await listObjects(target)).toEqual([]);
  });

  it("reads back a file larger than the error-output cap, whole", async () => {
    const target = await remote({ folder: "big" });
    const bytes = Uint8Array.from(
      { length: 5 * 1024 * 1024 + 7 },
      (_, i) => (i * 7) % 256,
    );
    await ensureDirectory(target);
    await putObject(
      target,
      "balancia-backup-20261009T033012Z.json.gz.age",
      bytes,
    );

    const back = await readObject(
      target,
      "balancia-backup-20261009T033012Z.json.gz.age",
    );

    expect(back.length).toBe(bytes.length);
    expect(back.equals(Buffer.from(bytes))).toBe(true);
  });

  it("refuses to hand back a file it would have to cut short", async () => {
    const target = await remote({ folder: "big" });

    await expect(
      readObject(target, "balancia-backup-20261009T033012Z.json.gz.age", {
        maxBytes: 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      code: "unknown",
      detail: expect.stringMatching(/larger/),
    });
  });

  it("keeps backups inside the folder it was given", async () => {
    const target = await remote({ folder: "family/backups" });
    await ensureDirectory(target);
    await putObject(
      target,
      "balancia-backup-20261009T033012Z.json.gz.age",
      new Uint8Array([1]),
    );

    expect(
      await readdir(join(directory, "family", "backups", "Balancia Backups")),
    ).toEqual(["balancia-backup-20261009T033012Z.json.gz.age"]);
  });

  it("reads an empty folder that was never made as empty", async () => {
    expect(await listObjects(await remote({ folder: "never-made" }))).toEqual(
      [],
    );
  });

  it("calls a wrong password a reason to reconnect, without echoing it", async () => {
    const attempt = checkConnection(
      await remote({ password: "not the password" }),
    );

    await expect(attempt).rejects.toMatchObject({ code: "reconnect" });
    await expect(attempt).rejects.not.toHaveProperty(
      "detail",
      expect.stringContaining("not the password"),
    );
  });

  it("calls a server that is not there unreachable", async () => {
    const dead = await freePort();

    await expect(
      checkConnection(await remote({ url: `http://127.0.0.1:${dead}` })),
    ).rejects.toMatchObject({ code: "unreachable" });
  });

  it("refuses a file name that is not one it made", async () => {
    const target = await remote();

    await expect(deleteObject(target, "../escape.txt")).rejects.toBeInstanceOf(
      BackupError,
    );
    await expect(deleteObject(target, "a b")).rejects.toBeInstanceOf(
      BackupError,
    );
  });
});

describe.skipIf(!CAN_SERVE_S3)("rclone over S3", () => {
  let port: number;

  beforeAll(async () => {
    port = await freePort();
    const buckets = join(root, "s3");
    await mkdir(join(buckets, "family-backups"), { recursive: true });
    serve([
      "serve",
      "s3",
      buckets,
      "--addr",
      `127.0.0.1:${port}`,
      "--auth-key",
      "AKIAEXAMPLE,s3cr3t-s3cr3t-s3cr3t",
    ]);
    await waitForPort(port);
  });

  const remote = (overrides: Record<string, unknown> = {}) =>
    buildRemote(
      "s3",
      {
        endpoint: `http://127.0.0.1:${port}`,
        region: "us-east-1",
        flavour: "Other",
        bucket: "family-backups",
        prefix: "",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "s3cr3t-s3cr3t-s3cr3t",
        pathStyle: true,
        ...overrides,
      },
      { obscure },
    );

  it("proves a bucket works the way a backup will use it", async () => {
    await expect(checkConnection(await remote())).resolves.toBeUndefined();
  });

  it("writes under the prefix and finds it again", async () => {
    const target = await remote({ prefix: "ada" });
    await putObject(
      target,
      "balancia-backup-20261009T033012Z.json.gz.age",
      new Uint8Array([7, 8, 9]),
    );

    expect(await listObjects(target)).toEqual([
      "balancia-backup-20261009T033012Z.json.gz.age",
    ]);
    expect([
      ...(await readObject(
        target,
        "balancia-backup-20261009T033012Z.json.gz.age",
      )),
    ]).toEqual([7, 8, 9]);
  });

  it("fails, and never quietly succeeds, with the wrong secret", async () => {
    // Which words come back depends on the server: AWS says
    // SignatureDoesNotMatch (classified in errors.test.ts), while rclone's own
    // test server makes rclone report "is a file not a directory". What is
    // true of both, and what matters, is that the attempt is refused.
    await expect(
      checkConnection(
        await remote({ secretAccessKey: "wrong-wrong-wrong-wrong" }),
      ),
    ).rejects.toBeInstanceOf(BackupError);
  });

  it("calls a bucket that does not exist not found", async () => {
    await expect(
      checkConnection(await remote({ bucket: "no-such-bucket" })),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/not_found|forbidden/),
    });
  });
});

describe("without rclone", () => {
  it("says so plainly rather than crashing", async () => {
    process.env.BACKUP_RCLONE_PATH = "/nonexistent/rclone";
    resetEnvCache();
    try {
      await expect(obscure("x")).rejects.toMatchObject({ code: "unavailable" });
    } finally {
      delete process.env.BACKUP_RCLONE_PATH;
      resetEnvCache();
    }
  });
});
