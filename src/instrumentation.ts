/**
 * Server startup hook.
 *
 * Next.js calls `register` once per server instance, before the first request
 * is served. Balancia uses it for exactly one thing: running the background
 * worker inside the web process when `RUN_WORKER_IN_WEB` says to.
 *
 * That setting exists for single-container installs, where there is no
 * `worker` service to run recurring expenses, the notification sweep and push
 * delivery. Without this hook the variable was accepted by the environment
 * schema, forwarded by Compose, documented as the way to make delivery work —
 * and read by nothing, so setting it did nothing at all and nothing was ever
 * pushed. See docs/notifications.md.
 */
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export async function register(): Promise<void> {
  // `register` also runs in the Edge runtime, which has no database driver and
  // no queue. The worker is Node-only.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!getEnv().RUN_WORKER_IN_WEB) return;

  const { startWorker } = await import("@/worker/run");

  try {
    await startWorker();
    logger.info(
      "Background worker is running inside the web process (RUN_WORKER_IN_WEB)",
    );
  } catch (error) {
    // Deliberately not fatal. A queue that cannot be reached must not stop the
    // app from serving pages — the same reason enqueuing a delivery never
    // fails a request. Loud in the log is the point: the previous behaviour
    // was to do nothing and say nothing.
    logger.error(
      {
        err:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      },
      "RUN_WORKER_IN_WEB is set but the background worker could not start; " +
        "no recurring expenses, sweeps or push notifications will be delivered",
    );
  }
}
