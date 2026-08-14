/**
 * Balancia background worker.
 *
 * Runs from the same image and the same source tree as the web process, and
 * calls the same domain services — a recurring expense generated here goes
 * through exactly the code path an interactive request would use.
 *
 * Start with `pnpm start:worker`, or as the `worker` service in Compose.
 */
import { closeDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  QUEUES,
  getBoss,
  stopBoss,
  type ImportCommitPayload,
  type NotificationsDeliverPayload,
} from "@/lib/jobs/queue";
import {
  deliverNotifications,
  pruneNotifications,
  sweepPendingNotifications,
} from "@/modules/notifications/delivery";
import { generateDueOccurrences } from "@/modules/recurring/service";
import { commitImportRun } from "@/modules/imports/service";
import { sweepOrphanedAttachments } from "@/modules/attachments/service";
import { pruneRateLimits } from "@/lib/security/rate-limit";
import {
  pruneRateQuotes,
  refreshActiveRates,
} from "@/modules/currencies/rates";
import { pruneGuestSessions } from "@/lib/security/guest-session";
import { pruneSessions } from "@/modules/auth/sessions";
import { pruneWebauthnChallenges } from "@/modules/auth/webauthn";

/** Uploads unattached for longer than this are swept away. */
const ORPHAN_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * How long cached rate quotes are kept. They are a convenience, not a record —
 * anything dropped here is re-fetched on demand, and no recorded rate depends
 * on it.
 */
const CACHED_RATE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * How long the notification inbox keeps an entry. It is a mailbox, not a
 * record: the permanent history of what happened is `activity_events`, which
 * is never pruned.
 */
const NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const env = getEnv();
  logger.info({ nodeEnv: env.NODE_ENV }, "Starting Balancia worker");

  const boss = await getBoss();

  await boss.work(QUEUES.recurringGenerate, async () => {
    const jobLogger = logger.child({ queue: QUEUES.recurringGenerate });
    const report = await generateDueOccurrences();
    jobLogger.info(report, "Generated recurring expenses");
  });

  await boss.work<ImportCommitPayload>(QUEUES.importCommit, async (jobs) => {
    const job = jobs[0];
    const jobLogger = logger.child({
      queue: QUEUES.importCommit,
      jobId: job.id,
      importRunId: job.data.importRunId,
    });
    const report = await commitImportRun(
      job.data.importRunId,
      job.data.groupId,
    );
    jobLogger.info(report, "Committed import run");
  });

  await boss.work(QUEUES.ratesRefresh, async () => {
    const jobLogger = logger.child({ queue: QUEUES.ratesRefresh });
    const report = await refreshActiveRates();
    jobLogger.info(report, "Refreshed exchange rates");
  });

  await boss.work<NotificationsDeliverPayload>(
    QUEUES.notificationsDeliver,
    async (jobs) => {
      const jobLogger = logger.child({ queue: QUEUES.notificationsDeliver });
      for (const job of jobs) {
        const report = await deliverNotifications(job.data.notificationIds);
        // Nothing claimed means another run already pushed these, which is
        // the expected outcome when pg-boss retries a job that succeeded.
        if (report.claimed > 0) {
          jobLogger.info(report, "Delivered notifications");
        }
      }
    },
  );

  await boss.work(QUEUES.notificationsSweep, async () => {
    const jobLogger = logger.child({ queue: QUEUES.notificationsSweep });
    const report = await sweepPendingNotifications();
    if (report.claimed > 0) {
      jobLogger.info(report, "Swept undelivered notifications");
    }
  });

  await boss.work(QUEUES.maintenance, async () => {
    const jobLogger = logger.child({ queue: QUEUES.maintenance });
    const now = new Date();
    const [
      orphans,
      rateLimitRows,
      guestSessionRows,
      sessionRows,
      challengeRows,
      rateQuoteRows,
      notificationRows,
    ] = await Promise.all([
      sweepOrphanedAttachments(
        new Date(now.getTime() - ORPHAN_UPLOAD_GRACE_MS),
      ),
      pruneRateLimits(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      pruneGuestSessions(now),
      pruneSessions(now),
      pruneWebauthnChallenges(now),
      pruneRateQuotes(new Date(now.getTime() - CACHED_RATE_RETENTION_MS)),
      pruneNotifications(new Date(now.getTime() - NOTIFICATION_RETENTION_MS)),
    ]);
    jobLogger.info(
      {
        orphans,
        rateLimitRows,
        guestSessionRows,
        sessionRows,
        challengeRows,
        rateQuoteRows,
        notificationRows,
      },
      "Maintenance sweep complete",
    );
  });

  // Recurring generation runs hourly: templates are timezone-aware, and an
  // hourly tick covers every timezone's midnight without a per-group schedule.
  await boss.schedule(QUEUES.recurringGenerate, "0 * * * *");
  await boss.schedule(QUEUES.maintenance, "30 3 * * *");
  // Every five minutes: only ever finds something when the queue or the web
  // process failed between committing a change and enqueuing its delivery.
  await boss.schedule(QUEUES.notificationsSweep, "*/5 * * * *");
  // Reference rates are published on weekday afternoons (around 15:00 UTC);
  // 15:45 picks them up the same day. A no-op when no provider is configured.
  await boss.schedule(QUEUES.ratesRefresh, "45 15 * * 1-5");

  logger.info(
    { queues: Object.values(QUEUES) },
    "Worker ready and subscribed to queues",
  );

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
