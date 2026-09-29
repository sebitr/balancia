/**
 * Keeps trying to start the worker inside the web process until it runs.
 *
 * A dedicated worker container that cannot reach its queue exits, and Compose
 * restarts it: the restart policy is its retry. The web process cannot do
 * that — a queue that is down must not take the pages down with it — so it
 * used to log the failure once and carry on without a worker until somebody
 * restarted it by hand. A database that was merely slower to come up than the
 * app, which is an ordinary morning after a host reboot, left recurring
 * expenses and push delivery off for as long as nobody noticed.
 *
 * So it retries, backing off from five seconds to five minutes: quick enough
 * that a database arriving a few seconds late costs a few seconds, and slow
 * enough that one that is gone for the night writes a line every five minutes
 * rather than a stream of them.
 */
import { logger } from "@/lib/logger";
import { stopBoss } from "@/lib/jobs/queue";
import { setWorkerState, workerState } from "@/lib/jobs/worker-status";

export const FIRST_RETRY_MS = 5_000;
export const MAX_RETRY_MS = 5 * 60_000;

/** How long to wait after the `failures`-th failed attempt: 5 s, 10 s, 20 s … 5 min. */
export function retryDelayMs(failures: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // Unref'd: a retry that is only waiting must never be what keeps a
    // stopping process alive.
    setTimeout(resolve, ms).unref();
  });
}

export interface SuperviseOptions {
  readonly start: () => Promise<void>;
  /** Clears away whatever a failed attempt left half started. */
  readonly stop?: () => Promise<void>;
  readonly wait?: (ms: number) => Promise<void>;
}

/**
 * Runs `start` until it succeeds or the process begins shutting down.
 *
 * Never rejects, and is not awaited by `register()`: Next waits for that hook
 * before serving the first request, and a database that takes minutes to
 * answer must not hold every page for as long.
 */
export async function superviseWorker({
  start,
  stop = () => stopBoss(),
  wait = sleep,
}: SuperviseOptions): Promise<void> {
  setWorkerState("starting");
  let failures = 0;

  for (;;) {
    try {
      await start();
    } catch (error) {
      if (workerState() === "stopping") return;
      failures += 1;
      setWorkerState("failed");
      const retryInMs = retryDelayMs(failures);

      // One line per failed attempt. The first carries the stack; after that
      // it is the same failure again, and the message is enough.
      logger.error(
        {
          err:
            failures === 1 && error instanceof Error
              ? (error.stack ?? error.message)
              : error instanceof Error
                ? error.message
                : String(error),
          attempt: failures,
          retryInSeconds: retryInMs / 1000,
        },
        "RUN_WORKER_IN_WEB is set but the background worker could not start; " +
          "no recurring expenses, sweeps or push notifications will be delivered " +
          "until it does. Retrying.",
      );

      // An attempt can fail after the queue started — a subscription or a
      // schedule refused halfway — and the next attempt would subscribe the
      // same queues a second time on top of it. Start again from nothing.
      await stop().catch(() => {});
      await wait(retryInMs);
      if (workerState() === "stopping") return;
      continue;
    }

    if (workerState() === "stopping") return;
    setWorkerState("running");
    logger.info(
      failures === 0 ? {} : { failedAttempts: failures },
      "Background worker is running inside the web process (RUN_WORKER_IN_WEB)",
    );
    return;
  }
}
