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
  /** Housekeeping: orphaned uploads, stale rate-limit windows, expired sessions. */
  maintenance: "maintenance.sweep",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface ImportCommitPayload {
  readonly importRunId: string;
  readonly groupId: string;
}

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

async function start(): Promise<PgBoss> {
  const env = getEnv();
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

  await instance.start();
  for (const queue of Object.values(QUEUES)) {
    await instance.createQueue(queue);
  }
  return instance;
}

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  starting ??= start().then((instance) => {
    boss = instance;
    return instance;
  });
  return starting;
}

export async function stopBoss(): Promise<void> {
  const instance = boss;
  boss = undefined;
  starting = undefined;
  if (instance) {
    // Graceful: let in-flight handlers finish, then close the pool.
    await instance.stop({ graceful: true, close: true, timeout: 30_000 });
    await new Promise<void>((resolve) => {
      instance.once("stopped", () => resolve());
      // Never hang shutdown on a queue that refuses to settle.
      setTimeout(resolve, 35_000).unref();
    });
  }
}

/** Enqueues a job. Safe to call from a request handler. */
export async function publish<T extends object>(
  queue: QueueName,
  payload: T,
  options: SendOptions = {},
): Promise<string | null> {
  const instance = await getBoss();
  return instance.send(queue, payload, options);
}
