import "server-only";
import { PgBoss, type SendOptions } from "pg-boss";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Background job queue.
 *
 * pg-boss stores its queues in the same PostgreSQL database (its own schema),
 * which is why Balancia needs no Redis. The web process only ever *publishes*;
 * the worker process subscribes. Both share this module so queue names cannot
 * drift apart.
 */

export const QUEUES = {
  /** Generates due recurring expense occurrences. */
  recurringGenerate: "recurring.generate",
  /** Commits a staged Splitwise import. */
  importCommit: "import.commit",
  /** Warms cached exchange rates for the pairs groups are using. */
  ratesRefresh: "rates.refresh",
  /** Pushes the notifications a just-committed change created. */
  notificationsDeliver: "notifications.deliver",
  /** Catches notifications the fast path above never got to. */
  notificationsSweep: "notifications.sweep",
  /** Housekeeping: orphaned uploads, stale rate-limit windows, expired sessions. */
  maintenance: "maintenance.sweep",
  /**
   * Builds and — if an administrator switched it on — sends one aggregated
   * anonymous usage report. Weekly, and a no-op on every instance that has not
   * opted in, which is all of them by default.
   */
  telemetryReport: "telemetry.report",
  /**
   * Collector only: folds received reports into daily counts and deletes the
   * raw payloads. Does nothing unless this deployment runs the receiver.
   */
  telemetryAggregate: "telemetry.aggregate",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface ImportCommitPayload {
  readonly importRunId: string;
  readonly groupId: string;
}

export interface NotificationsDeliverPayload {
  readonly notificationIds: readonly string[];
}

/**
 * How long a stopping process gives the jobs it has in hand to finish.
 *
 * Stated once, because the grace periods in the Compose files are sized
 * around it: `compose.yaml` gives the app thirty seconds between SIGTERM and
 * SIGKILL (`stop_grace_period`), and the dedicated worker forty. Inside that,
 * pg-boss stops fetching at once, waits up to this long for running jobs, then
 * fails whatever is still running back to the queue — where it is retried,
 * which the jobs are written to survive — and closes its pool.
 * `STOP_SLACK_MS` bounds that last part. Twenty plus five leaves five of the
 * app's thirty seconds for the process to exit, and `queue.test.ts` fails the
 * build if a grace period stops covering both.
 *
 * Long enough for a recurring-expense run or a typical import commit. A very
 * large import that overruns is cut and retried, which costs delay, not data.
 */
export const SHUTDOWN_DRAIN_MS = 20_000;

/** What pg-boss is allowed after the drain to fail the stragglers and close. */
export const STOP_SLACK_MS = 5_000;

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

async function start(): Promise<PgBoss> {
  const env = getEnv();
  if (env.DEMO_MODE || !env.DATABASE_URL) {
    // A demo instance is the only deployment without one: pg-boss stores its
    // queues in PostgreSQL, and an in-memory database that vanishes on restart
    // is no place for a job queue. `publish` short-circuits before reaching
    // here; this covers anything that calls `getBoss()` directly.
    throw new Error(
      "The job queue needs a PostgreSQL connection and this instance has none " +
        "(DEMO_MODE). Background jobs do not run on a demo.",
    );
  }
  const instance = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    // Keep the queue's own pool small; the app pool handles request traffic.
    max: 4,
    application_name: "balancia-jobs",
  });

  instance.on("error", (error: Error) => {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Job queue error",
    );
  });

  try {
    await instance.start();
    for (const queue of Object.values(QUEUES)) {
      await instance.createQueue(queue);
    }
  } catch (error) {
    // A half-started instance still holds a pool and timers. Let them go
    // before the next attempt makes another, or every retry leaks one.
    await instance.stop({ graceful: false, close: true }).catch(() => {});
    throw error;
  }
  return instance;
}

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (!starting) {
    const attempt: Promise<PgBoss> = start().then(
      (instance) => {
        boss = instance;
        return instance;
      },
      (error: unknown) => {
        // Forget a failed start. Cached, it was handed to every later caller
        // until the process restarted, so one database blip at boot meant no
        // job was ever published or served again. Only this attempt is
        // forgotten: a newer one may already be under way.
        if (starting === attempt) starting = undefined;
        throw error;
      },
    );
    starting = attempt;
  }
  return starting;
}

/**
 * Stops the queue: no more fetching, running jobs given `drainMs` to finish.
 *
 * pg-boss's `stop()` resolves only once all of that is done, jobs failed back
 * to the queue and pool closed. This used to wait for a `stopped` event
 * afterwards as well — an event `stop()` had already emitted before it
 * resolved, so every shutdown sat through the whole fallback timer for
 * nothing. The timer that remains is the one worth having: a queue that never
 * settles must not hold the process past its grace period.
 */
export async function stopBoss(drainMs = SHUTDOWN_DRAIN_MS): Promise<void> {
  const instance = boss;
  boss = undefined;
  starting = undefined;
  if (!instance) return;

  let giveUp: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      instance.stop({ graceful: true, close: true, timeout: drainMs }),
      new Promise<void>((resolve) => {
        giveUp = setTimeout(resolve, drainMs + STOP_SLACK_MS);
        giveUp.unref();
      }),
    ]);
  } finally {
    clearTimeout(giveUp);
  }
}

/** Enqueues a job. Safe to call from a request handler. */
export async function publish<T extends object>(
  queue: QueueName,
  payload: T,
  options: SendOptions = {},
): Promise<string | null> {
  // A demo instance has no queue to publish to. Silent rather than thrown:
  // every caller already treats enqueuing as best-effort — a queue that cannot
  // be reached must not fail the request that triggered it.
  if (getEnv().DEMO_MODE) return null;
  const instance = await getBoss();
  return instance.send(queue, payload, options);
}
