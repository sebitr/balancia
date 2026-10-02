/**
 * Proof of life for the dedicated worker container.
 *
 * The web process has `/api/health/ready`. The worker serves no HTTP, so the
 * image's healthcheck — a curl to the web server — cannot apply to it, and its
 * Compose service used to switch healthchecks off altogether: a worker that
 * was up but serving nothing looked exactly like one that was working.
 *
 * So it writes a file instead, every thirty seconds, for as long as it is
 * subscribed and its queue's database answers, and the healthcheck in
 * compose.yaml looks at how old the file is. A file is the cheapest thing a
 * process with no port can offer: no listener, nothing to authenticate, and a
 * shell one-liner to read.
 */
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** `/tmp/balancia-worker.heartbeat` in the image — compose.yaml names it. */
export const HEARTBEAT_FILE = path.join(tmpdir(), "balancia-worker.heartbeat");

/** compose.yaml calls the worker unhealthy after ninety seconds: three beats. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Removes a file an earlier process left behind. The container's filesystem
 * outlives a restart, and a fresh-looking file from before it would vouch for
 * a worker that has not started yet.
 *
 * Never fatal: a worker that cannot touch the file still does its work, and
 * the healthcheck is left to say the rest.
 */
export async function clearHeartbeat(file = HEARTBEAT_FILE): Promise<void> {
  await rm(file, { force: true }).catch(() => {});
}

/**
 * Beats now and every interval after, while `isAlive` says so. Returns the
 * function that stops it.
 */
export function startHeartbeat(
  isAlive: () => Promise<boolean>,
  file = HEARTBEAT_FILE,
): () => void {
  const beat = async (): Promise<void> => {
    try {
      if (await isAlive()) {
        await writeFile(file, `${new Date().toISOString()}\n`);
      }
    } catch {
      // A missed beat is the whole message; the file going stale says it.
    }
  };

  void beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  // Never what keeps a stopping worker alive.
  timer.unref();
  return () => clearInterval(timer);
}
