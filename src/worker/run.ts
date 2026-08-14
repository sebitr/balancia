/**
 * What the worker actually does: the queues it serves, and on what schedule.
 *
 * Kept apart from `index.ts` because these registrations run in two shapes —
 * as the dedicated `worker` container, and inside the web process when a
 * single-container install sets `RUN_WORKER_IN_WEB` (see
 * `src/instrumentation.ts`). One copy, so the two can never drift: a queue
 * added here is served by both, and a deployment cannot end up quietly
 * missing half the background work.
 */
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  QUEUES,
  getBoss,
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

/**
 * Subscribes to every queue and installs the schedules.
 *
 * Resolves once the worker is serving; throws if the queue cannot be reached,
 * which the caller decides what to do about — a dedicated container exits, the
 * web process logs and carries on serving pages.
 */
export async function startWorker(): Promise<void> {
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
    { queues: Object.values(QUEUES), nodeEnv: getEnv().NODE_ENV },
    "Worker ready and subscribed to queues",
  );
}
