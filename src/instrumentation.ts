/**
 * Server startup hook.
 *
 * Next.js calls `register` once per server instance, before the first request
 * is served. Balancia uses it for exactly one thing: running the background
 * worker inside the web process when `RUN_WORKER_IN_WEB` says to.
 *
 * Which it does by default, so this is the ordinary path rather than a special
 * case — recurring expenses, the notification sweep and push delivery all run
 * from here unless a deployment has a `worker` container and turned the
 * setting off. Without this hook the variable was accepted by the environment
 * schema, forwarded by Compose, documented as the way to make delivery work —
 * and read by nothing, so setting it did nothing at all and nothing was ever
 * pushed. See docs/notifications.md.
 */
import type { Instrumentation } from "next";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Server-side errors, on their way to being classified.
 *
 * Next.js calls this for every error it catches while rendering or serving —
 * the one place that sees them all, which is why crash reporting hangs here
 * rather than from a dozen try/catch blocks.
 *
 * Two of the three arguments are deliberately dropped. `request` carries the
 * path, the query string and the headers; `context.routePath` is the route
 * *file* (`/groups/[groupId]/expenses/[expenseId]`), which is a template with
 * no values in it. Only the last is passed on, as a coarse component — and
 * only when an administrator switched crash reports on, which is off by
 * default. The error itself never leaves in any form but its class name.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  _request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { reportCrash } = await import("@/lib/telemetry/crash-reporter");
  await reportCrash(error, componentFor(context.routeType));
};

/**
 * A Server Action that reached here escaped `runAction`; the ones it catches
 * are reported there and never rethrown, so nothing is counted twice.
 */
function componentFor(
  routeType: Parameters<Instrumentation.onRequestError>[2]["routeType"],
): "route-handler" | "server-action" | "render" {
  if (routeType === "route") return "route-handler";
  if (routeType === "action") return "server-action";
  return "render";
}

export async function register(): Promise<void> {
  // `register` also runs in the Edge runtime, which has no database driver and
  // no queue. The worker is Node-only.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // First, ahead of anything below that can fail. The Docker image sets
  // NEXT_MANUAL_SIG_HANDLE, so Next registers no signal handler of its own,
  // and without this one SIGTERM would end the process on the spot — running
  // jobs, requests in flight and all. See src/worker/shutdown.ts.
  const { installShutdownHandler } = await import("@/worker/shutdown");
  installShutdownHandler();

  const env = getEnv();

  /*
   * A demo instance has no PostgreSQL to connect to: it builds the schema in
   * memory here, from the committed migrations, and `getDb()` hands that to
   * every query for the life of the process.
   *
   * This must finish before the first request, and it does — Next calls
   * `register` once per server instance and waits for it. It is also the one
   * failure in this file that *is* fatal: an unbootstrapped demo instance can
   * serve nothing, so it should refuse to come up rather than 500 every page.
   */
  if (env.DEMO_MODE) {
    if (env.DATABASE_URL) {
      // Usually harmless — a demo container sharing the real stack's `.env`
      // picks one up. Said out loud all the same, because the one reading that
      // is wrong is an operator who switched DEMO_MODE on next to real
      // accounts and is about to wonder where they went.
      logger.warn(
        "DEMO_MODE is on, so DATABASE_URL is ignored: this instance serves an " +
          "in-memory database and no account in PostgreSQL can be reached from it",
      );
    }

    const { bootstrapDemoDatabase } = await import("@/lib/db/demo-database");
    await bootstrapDemoDatabase();

    const { startDemoSweeper } = await import("@/modules/demo/sessions");
    startDemoSweeper();

    // pg-boss keeps its queues in a real database, so there is nothing for the
    // worker to attach to. Recurring expenses and notification delivery are
    // the visible cost, and docs/demo.md says so.
    logger.info("Demo mode: background jobs are off and no data is persisted");
    return;
  }

  if (!env.RUN_WORKER_IN_WEB) return;

  const { startWorker } = await import("@/worker/run");
  const { superviseWorker } = await import("@/worker/supervise");

  // Deliberately not awaited, and deliberately not fatal. A queue that cannot
  // be reached must not stop the app from serving pages — the same reason
  // enqueuing a delivery never fails a request — and Next holds the first
  // request until this hook returns. So the worker starts beside the server,
  // retries until it runs, and says where it stands in the log, in
  // /api/health/ready and in `balancia_worker_up`. The previous behaviour was
  // one attempt, one log line, and no worker until somebody restarted the app.
  void superviseWorker({ start: startWorker });
}
