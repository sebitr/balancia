/**
 * What the worker actually does: the queues it serves, and on what schedule.
 *
 * Kept apart from `index.ts` because these registrations run in two shapes —
 * inside the web process, which is the default and what `RUN_WORKER_IN_WEB`
 * selects (see `src/instrumentation.ts`), and as the dedicated `worker`
 * container for a deployment that turned that off. One copy, so the two can
 * never drift: a queue added here is served by both, and a deployment cannot
 * end up quietly missing half the background work.
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
import { pruneUnclaimedAccounts } from "@/modules/auth/signup";
import { pruneProofOfWorkChallenges } from "@/lib/security/proof-of-work";
import { pruneWebauthnChallenges } from "@/modules/auth/webauthn";
import { pruneCounters, utcDayBefore } from "@/lib/telemetry/counters";
import { providerFor } from "@/lib/telemetry/providers";
import {
  aggregateReceivedReports,
  pruneRawReports,
} from "@/lib/telemetry/receiver";
import { COUNTER_RETENTION_DAYS } from "@/lib/telemetry/report";
import { getEffectiveTelemetry } from "@/lib/telemetry/settings";
import { reportCrash } from "@/lib/telemetry/crash-reporter";
import { jobDuration, jobOutcomes, secondsSince } from "@/lib/metrics/metrics";

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
 * Floor on the gap between two anonymous usage reports.
 *
 * The schedule is weekly; this is what makes "weekly" true even when the job
 * runs twice — a pg-boss retry, or a deployment where the web process and a
 * worker container both installed the schedule.
 */
const MIN_REPORT_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Subscribes to every queue and installs the schedules.
 *
 * Resolves once the worker is serving; throws if the queue cannot be reached,
 * which the caller decides what to do about — a dedicated container exits, the
 * web process logs and carries on serving pages.
 */
/**
 * Wraps a job body in the two things every job should do and none of them
 * should have to remember: time itself into the local metrics, and hand a
 * failure to the crash reporter on its way past.
 *
 * The reporter is a no-op unless an administrator switched crash reports on,
 * and it never swallows the error — pg-boss must still see the rejection so it
 * can retry the job.
 */
async function instrumented<T>(
  queue: string,
  body: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await body();
    jobDuration().observe(secondsSince(startedAt), { queue });
    jobOutcomes().increment({ queue, outcome: "ok" });
    return result;
  } catch (error) {
    jobDuration().observe(secondsSince(startedAt), { queue });
    jobOutcomes().increment({ queue, outcome: "failed" });
    await reportCrash(
      error,
      queue === QUEUES.recurringGenerate ? "scheduler" : "job",
    );
    throw error;
  }
}

export async function startWorker(): Promise<void> {
  const boss = await getBoss();

  await boss.work(QUEUES.recurringGenerate, async () => {
    const jobLogger = logger.child({ queue: QUEUES.recurringGenerate });
    const report = await instrumented(QUEUES.recurringGenerate, () =>
      generateDueOccurrences(),
    );
    jobLogger.info(report, "Generated recurring expenses");
  });

  await boss.work<ImportCommitPayload>(QUEUES.importCommit, async (jobs) => {
    const job = jobs[0];
    const jobLogger = logger.child({
      queue: QUEUES.importCommit,
      jobId: job.id,
      importRunId: job.data.importRunId,
    });
    const report = await instrumented(QUEUES.importCommit, () =>
      commitImportRun(job.data.importRunId, job.data.groupId),
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

  /**
   * The weekly anonymous usage report.
   *
   * Runs on every instance and does nothing on almost all of them: the
   * provider is the null one unless an administrator opted in, and a null
   * provider's report is a no-op with no network involved. Scheduling it
   * unconditionally means the switch takes effect without a restart.
   */
  await boss.work(QUEUES.telemetryReport, async () => {
    const jobLogger = logger.child({ queue: QUEUES.telemetryReport });
    const outcome = await instrumented(QUEUES.telemetryReport, async () => {
      const settings = await getEffectiveTelemetry({ fresh: true });

      // One report a week, whatever else happens. A retried job, a second
      // scheduler in a deployment running both shapes, and an administrator
      // pressing "send test report" the day before all arrive here, and none
      // of them is a reason to send a second time.
      const lastSent = settings.stored.lastReportSentAt;
      if (
        lastSent &&
        Date.now() - lastSent.getTime() < MIN_REPORT_INTERVAL_MS
      ) {
        return { status: "skipped" as const };
      }

      return providerFor(settings).sendPeriodicReport();
    });
    if (outcome.status !== "skipped") {
      jobLogger.info(outcome, "Anonymous usage report");
    }
  });

  /**
   * Collector housekeeping. A no-op everywhere except the one deployment that
   * accepts reports, where it is what keeps raw payloads from accumulating.
   */
  await boss.work(QUEUES.telemetryAggregate, async () => {
    const jobLogger = logger.child({ queue: QUEUES.telemetryAggregate });
    if (!getEnv().TELEMETRY_RECEIVER) return;
    const report = await instrumented(QUEUES.telemetryAggregate, async () => {
      const aggregated = await aggregateReceivedReports();
      const pruned = await pruneRawReports();
      return { ...aggregated, pruned };
    });
    jobLogger.info(report, "Folded received telemetry reports");
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
      proofOfWorkRows,
      unclaimedAccounts,
      rateQuoteRows,
      notificationRows,
      telemetryCounterRows,
    ] = await Promise.all([
      sweepOrphanedAttachments(
        new Date(now.getTime() - ORPHAN_UPLOAD_GRACE_MS),
      ),
      pruneRateLimits(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      pruneGuestSessions(now),
      pruneSessions(now),
      pruneWebauthnChallenges(now),
      pruneProofOfWorkChallenges(now),
      // Addresses somebody claimed and never proved. A no-op on an instance
      // with no mail server, which is the only place it would be dangerous.
      pruneUnclaimedAccounts(now),
      pruneRateQuotes(new Date(now.getTime() - CACHED_RATE_RETENTION_MS)),
      pruneNotifications(new Date(now.getTime() - NOTIFICATION_RETENTION_MS)),
      // Two weeks of product counters: one week is what a report covers, and
      // the rest is slack for a missed run. Keeping months of them would
      // rebuild exactly the history bucketing exists to avoid.
      pruneCounters(utcDayBefore(now, COUNTER_RETENTION_DAYS)),
    ]);
    jobLogger.info(
      {
        orphans,
        rateLimitRows,
        guestSessionRows,
        sessionRows,
        challengeRows,
        proofOfWorkRows,
        unclaimedAccounts,
        rateQuoteRows,
        notificationRows,
        telemetryCounterRows,
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
  // Once a week, and never per event: an opted-in instance makes one outbound
  // request every seven days. Sunday at 04:17 rather than on the hour, so a
  // few thousand installations do not arrive at the collector together.
  await boss.schedule(QUEUES.telemetryReport, "17 4 * * 0");
  // Collector housekeeping, daily. Does nothing where the receiver is off.
  await boss.schedule(QUEUES.telemetryAggregate, "40 3 * * *");

  logger.info(
    { queues: Object.values(QUEUES), nodeEnv: getEnv().NODE_ENV },
    "Worker ready and subscribed to queues",
  );
}
