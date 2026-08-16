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
