import "server-only";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEnv } from "@/lib/env";
import { BackupError, classify, scrub } from "./errors";
import { REMOTE, type RcloneRemote } from "./rclone-config";

/**
 * rclone, as a child process, with exactly what it needs and nothing else.
 *
 * rclone is the transport for every provider (see `docs/cloud-backup.md` for why
 * it is a binary and not a client library per provider). Running another
 * program with a person's cloud credentials is only acceptable if the program
 * gets nothing it was not meant to have, so:
 *
 *  - **The environment is built, not inherited.** The child gets a `PATH`, a
 *    scratch directory to call home, proxy and certificate settings if the
 *    operator set them, and the `RCLONE_CONFIG_BACKUP_*` variables for this one
 *    remote. It never sees `AUTH_SECRET` or `DATABASE_URL`.
 *  - **Arguments carry no secrets.** They are a subcommand, flags we chose, and
 *    a path built from a file name we generated. A password goes in on stdin
 *    or in the environment, both invisible to `ps`.
 *  - **Nothing is written outside a scratch directory** that is created for the
 *    one call and removed after it, whether the call worked or not.
 *  - **Everything has a deadline.** A child that hangs is killed, because a
 *    worker that waits forever on someone's slow NAS is a worker that no longer
 *    backs anyone else up.
 *  - **What comes back is scrubbed** before it is stored or shown: the secrets
 *    it was given are removed by value, then anything shaped like one.
 */

/** Error text kept from a child. Listings are short; this is a guard, not a budget. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * The most a file read back may be, held in memory on its way to the browser.
 * Generous for what a backup is — JSON, compressed — and a ceiling rather than
 * a target: past it the read fails, because a backup quietly cut short is the
 * worst thing this feature could hand someone.
 */
export const MAX_READ_BYTES = 256 * 1024 * 1024;

/** Settings the operator may have made for outbound connections. */
const PASSTHROUGH = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "TZ",
] as const;

const COMMON_FLAGS = [
  "--log-level",
  "ERROR",
  "--stats",
  "0",
  "--contimeout",
  "30s",
  "--timeout",
  "2m",
  "--low-level-retries",
  "5",
] as const;

/** A file name we made, never one a person typed: letters, digits, dot, dash, underscore. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;

function binary(): string {
  return getEnv().BACKUP_RCLONE_PATH ?? "rclone";
}

interface Result {
  readonly stdout: Buffer;
  readonly stderr: string;
}

interface RunOptions {
  readonly remote?: RcloneRemote;
  readonly stdin?: Uint8Array | string;
  readonly timeoutMs?: number;
  /** Extra values to remove from anything reported, beyond the remote's own. */
  readonly secrets?: readonly string[];
  /** How much standard output to accept before refusing, rather than truncating. */
  readonly maxStdoutBytes?: number;
}

/** Every string a remote holds that must not appear in a message about it. */
function secretsOf(remote: RcloneRemote | undefined): string[] {
  if (!remote) return [];
  const found: string[] = [];
  for (const value of Object.values(remote.env)) {
    found.push(value);
    if (value.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (parsed && typeof parsed === "object") {
          for (const inner of Object.values(parsed)) {
            if (typeof inner === "string") found.push(inner);
          }
        }
      } catch {
        // Not JSON after all; the whole value is already in the list.
      }
    }
  }
  return found;
}

async function run(
  args: readonly string[],
  options: RunOptions = {},
): Promise<Result> {
  const scratch = await mkdtemp(join(tmpdir(), "balancia-rclone-"));
  const secrets = [...secretsOf(options.remote), ...(options.secrets ?? [])];

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: scratch,
    TMPDIR: scratch,
    RCLONE_CONFIG: join(scratch, "rclone.conf"),
    RCLONE_CACHE_DIR: scratch,
  };
  for (const name of PASSTHROUGH) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  Object.assign(env, options.remote?.env);

  try {
    return await new Promise<Result>((resolve, reject) => {
      const child = spawn(binary(), [...args], {
        // Cast, not widened: `ProcessEnv` insists on a `NODE_ENV` that this
        // environment is deliberately built without.
        env: env as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outSize = 0;
      let errSize = 0;
      let timedOut = false;
      let tooLarge = false;
      const stdoutLimit = options.maxStdoutBytes ?? MAX_OUTPUT_BYTES;

      const timer = setTimeout(
        () => {
          timedOut = true;
          child.kill("SIGKILL");
        },
        options.timeoutMs ?? 10 * 60_000,
      );

      child.stdout.on("data", (chunk: Buffer) => {
        outSize += chunk.length;
        if (outSize <= stdoutLimit) {
          out.push(chunk);
        } else if (!tooLarge) {
          // Never hand back the first part of something as if it were all.
          tooLarge = true;
          child.kill("SIGKILL");
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        errSize += chunk.length;
        if (errSize <= MAX_OUTPUT_BYTES) err.push(chunk);
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(
          error.code === "ENOENT"
            ? new BackupError(
                "unavailable",
                "rclone is not installed on this server.",
              )
            : new BackupError("unknown", scrub(error.message, secrets)),
        );
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const stderr = Buffer.concat(err).toString("utf8");
        if (tooLarge) {
          reject(
            new BackupError(
              "unknown",
              "That file is larger than this server will read back.",
            ),
          );
        } else if (timedOut) {
          reject(
            new BackupError(
              "unreachable",
              "The cloud did not answer in time and the attempt was stopped.",
            ),
          );
        } else if (code !== 0) {
          reject(new BackupError(classify(stderr), scrub(stderr, secrets)));
        } else {
          resolve({ stdout: Buffer.concat(out), stderr });
        }
      });

      // A child that exits before reading its input closes the pipe on us.
      child.stdin.on("error", () => {});
      child.stdin.end(options.stdin);
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function target(remote: RcloneRemote, name?: string): string {
  if (name !== undefined && !SAFE_NAME.test(name)) {
    throw new BackupError("unknown", "Refusing an unexpected file name.");
  }
  const path =
    name === undefined ? remote.directory : `${remote.directory}/${name}`;
  return `${REMOTE}:${path}`;
}

let available: boolean | undefined;

/** Whether the rclone this server was told about runs. Remembered once it does. */
export async function rcloneAvailable(): Promise<boolean> {
  if (available) return true;
  try {
    await run(["version"], { timeoutMs: 15_000 });
    available = true;
  } catch {
    return false;
  }
  return true;
}

/** Test hook. */
export function resetRcloneAvailability(): void {
  available = undefined;
}

/**
 * rclone's reversible "obscuring" of a password.
 *
 * Several of its backends will not take a password as it is. The password goes
 * in on stdin, not in an argument, so it is never in a process listing.
 */
export async function obscure(value: string): Promise<string> {
  const { stdout } = await run(["obscure", "-"], {
    stdin: value,
    timeoutMs: 15_000,
    secrets: [value],
  });
  return stdout.toString("utf8").trim();
}

/** Creates the backup folder if it is not there yet. */
export async function ensureDirectory(remote: RcloneRemote): Promise<void> {
  await run([...COMMON_FLAGS, "mkdir", target(remote)], { remote });
}

/**
 * Writes `bytes` as `name`, from stdin, without ever touching the local disk.
 *
 * `--retries 1`: rclone's own retry of a streamed upload would read an input
 * it has already consumed. A failed attempt is retried by the job instead,
 * from the start, with the bytes still in hand.
 */
export async function putObject(
  remote: RcloneRemote,
  name: string,
  bytes: Uint8Array,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  await run([...COMMON_FLAGS, "--retries", "1", "rcat", target(remote, name)], {
    remote,
    stdin: bytes,
    timeoutMs: options.timeoutMs,
  });
}

/** The names of the files in the backup folder. An absent folder is an empty one. */
export async function listObjects(remote: RcloneRemote): Promise<string[]> {
  try {
    const { stdout } = await run(
      [...COMMON_FLAGS, "lsf", "--files-only", target(remote)],
      { remote },
    );
    return stdout
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  } catch (error) {
    if (error instanceof BackupError && error.code === "not_found") return [];
    throw error;
  }
}

export async function deleteObject(
  remote: RcloneRemote,
  name: string,
): Promise<void> {
  await run([...COMMON_FLAGS, "deletefile", target(remote, name)], { remote });
}

/** Reads one file back. For restore; the server only ever holds ciphertext. */
export async function readObject(
  remote: RcloneRemote,
  name: string,
  options: { maxBytes?: number } = {},
): Promise<Buffer> {
  const { stdout } = await run([...COMMON_FLAGS, "cat", target(remote, name)], {
    remote,
    timeoutMs: 5 * 60_000,
    maxStdoutBytes: options.maxBytes ?? MAX_READ_BYTES,
  });
  return stdout;
}

/**
 * Proves a destination works the way a backup will use it: make the folder,
 * write a file, see it listed, delete it. A key that can list a bucket but not
 * write to it, or write but not delete, is found here and not at 03:30.
 *
 * The file is named at random so two tests never meet, and it is deleted even
 * if the listing fails; one that cannot be deleted is reported rather than
 * left to accumulate.
 */
export async function checkConnection(remote: RcloneRemote): Promise<void> {
  const name = `balancia-connection-test-${randomBytes(6).toString("hex")}.txt`;
  await ensureDirectory(remote);
  await putObject(
    remote,
    name,
    new TextEncoder().encode("Balancia connection test\n"),
    {
      timeoutMs: 2 * 60_000,
    },
  );
  try {
    const names = await listObjects(remote);
    if (!names.includes(name)) {
      throw new BackupError(
        "forbidden",
        "The test file was written but could not be seen again.",
      );
    }
  } finally {
    await deleteObject(remote, name);
  }
}
