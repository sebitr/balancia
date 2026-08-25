/**
 * Balancia background worker, as a process of its own.
 *
 * Runs from the same image and the same source tree as the web process, and
 * calls the same domain services — a recurring expense generated here goes
 * through exactly the code path an interactive request would use.
 *
 * Start with `pnpm start:worker`, or as the `worker` service in Compose, which
 * is off unless its profile is enabled. By default nothing runs this file at
 * all: the web process runs the very same registrations itself. Both come from
 * `./run`, so the two shapes cannot drift.
 */
import { closeDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { stopBoss } from "@/lib/jobs/queue";
import { startWorker } from "./run";

async function main(): Promise<void> {
  const env = getEnv();
  logger.info({ nodeEnv: env.NODE_ENV }, "Starting Balancia worker");

  if (env.RUN_WORKER_IN_WEB) {
    // Both shapes at once: every queue would have two subscribers in this
    // deployment. Harmless — pg-boss hands each job to one of them — but it is
    // never what anybody meant, so say so rather than let it look intentional.
    //
    // This is the likely state of a deployment that enabled the `worker`
    // profile and stopped there: RUN_WORKER_IN_WEB defaults to true, so the
    // second half has to be written down, and this is where forgetting it
    // surfaces.
    logger.warn(
      "RUN_WORKER_IN_WEB is on and this dedicated worker is also running. " +
        "The web process is serving the same queues; set RUN_WORKER_IN_WEB=false " +
        "in .env unless that is deliberate.",
    );
  }

  await startWorker();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down worker");
    try {
      // Graceful: let in-flight jobs finish before the pool closes.
      await stopBoss();
      await closeDb();
      logger.info("Worker stopped cleanly");
      process.exit(0);
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "Error during worker shutdown",
      );
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  logger.error(
    {
      err:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    },
    "Worker failed to start",
  );
  process.exit(1);
});
