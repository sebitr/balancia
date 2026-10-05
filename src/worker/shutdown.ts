/**
 * Letting the web process's jobs finish when it is asked to stop.
 *
 * The worker runs inside the web process by default, and Next's own signal
 * handler knows nothing about it: on SIGTERM it closes the HTTP server and
 * calls `process.exit`, so every deploy cut short whatever import commit or
 * recurring run happened to be under way. pg-boss would retry it and nothing
 * was corrupted, but the job started over from the beginning, late.
 *
 * Next has exactly one supported way to run cleanup before it exits, and it
 * is all or nothing: with `NEXT_MANUAL_SIG_HANDLE` set when the server starts,
 * it registers no handler at all and leaves the signals to the application.
 * The Docker image sets it, so this handler is what stops that process. It
 * drains the queue within `SHUTDOWN_DRAIN_MS` and exits with the code Next
 * would have used.
 *
 * What Next's handler did and this one does not is close the HTTP server and
 * wait for the requests in flight. Here the server goes on answering while the
 * jobs drain, and a request caught mid-way at the moment of exit is cut. That
 * is the cheaper side of the trade: the drain only waits when a job is
 * actually running, so it is usually over in milliseconds, and a cut request
 * is milliseconds of work to make again.
 *
 * Without the variable — `next dev`, and `next start` run by hand — Next keeps
 * its own handler and this installs nothing, because a second handler racing
 * Next's `process.exit` would be a drain that never gets to finish.
 */
import { logger } from "@/lib/logger";
import { SHUTDOWN_DRAIN_MS, stopBoss } from "@/lib/jobs/queue";
import { setWorkerState } from "@/lib/jobs/worker-status";

/** 128 plus the signal's number, as Next's own handler exits. */
const EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

export type ShutdownSignal = keyof typeof EXIT_CODES;

/**
 * The handler, as a function of what it stops and how it exits, so a test can
 * run it without sending a signal to the test runner.
 *
 * Runs once. Docker sends SIGTERM and a person at a terminal may follow it
 * with Ctrl-C; the second signal must not start a second drain, nor exit
 * while the first is still letting a job finish.
 */
export function createShutdown({
  stop = stopBoss,
  exit = (code: number) => process.exit(code),
}: {
  readonly stop?: (drainMs: number) => Promise<void>;
  readonly exit?: (code: number) => void;
} = {}): (signal: ShutdownSignal) => Promise<void> {
  let started = false;

  return async (signal) => {
    if (started) return;
    started = true;

    setWorkerState("stopping");
    logger.info(
      { signal, drainSeconds: SHUTDOWN_DRAIN_MS / 1000 },
      "Shutting down; letting background jobs in hand finish",
    );

    try {
      await stop(SHUTDOWN_DRAIN_MS);
    } catch (error) {
      logger.error(
        { err: error },
        "The job queue did not stop cleanly; unfinished jobs will be retried",
      );
    }

    exit(EXIT_CODES[signal]);
  };
}

/** Installs the handler — only where Next was told to leave the signals alone. */
export function installShutdownHandler(): void {
  if (!process.env.NEXT_MANUAL_SIG_HANDLE) return;

  const shutdown = createShutdown();
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
