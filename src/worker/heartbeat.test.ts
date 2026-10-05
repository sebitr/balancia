import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearHeartbeat, startHeartbeat } from "./heartbeat";

/**
 * The worker container's healthcheck reads nothing but this file's age, so
 * the file has to be written exactly when the worker is well, and not
 * otherwise.
 */

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "balancia-heartbeat-"));
  file = path.join(directory, "balancia-worker.heartbeat");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

describe("the worker heartbeat", () => {
  it("beats at once while the worker is alive", async () => {
    const stop = startHeartbeat(async () => true, file);

    await vi.waitFor(async () => expect(await exists(file)).toBe(true));
    stop();
  });

  it("stays silent while the queue's database does not answer", async () => {
    const isAlive = vi.fn(async (): Promise<boolean> => {
      throw new Error("Connection terminated unexpectedly");
    });
    const stop = startHeartbeat(isAlive, file);

    await vi.waitFor(() => expect(isAlive).toHaveBeenCalled());
    stop();
    expect(await exists(file)).toBe(false);
  });

  it("clears a file an earlier process left behind", async () => {
    // The container's filesystem survives a restart; a fresh-looking file
    // from the process before would vouch for one that has not started.
    await writeFile(file, "from before the restart\n");

    await clearHeartbeat(file);

    expect(await exists(file)).toBe(false);
  });
});
