import { getEnv } from "@/lib/env";

/**
 * Whether the background worker in this process is actually serving its
 * queues.
 *
 * It needs saying because nothing else says it. A web process whose worker
 * failed to start goes on serving pages — deliberately — and until this
 * existed it went on reporting itself ready and healthy too, while no
 * recurring expense was generated, no push delivered and nothing pruned.
 * `/api/health/ready` and `balancia_worker_up` both read it from here.
 *
 * - `starting` — the first attempt is under way.
 * - `running` — subscribed to every queue, schedules installed.
 * - `failed` — an attempt failed and none has succeeded since; another is
 *   coming (`src/worker/supervise.ts`).
 * - `stopping` — the process is shutting down and letting jobs finish.
 *
 * Held on `globalThis` for the same reason the metrics registry is: Next.js
 * bundles `instrumentation.ts`, which starts the worker, apart from the route
 * handlers that report on it, and a module-level variable would leave each of
 * them with a copy of its own.
 */
export type WorkerState = "starting" | "running" | "failed" | "stopping";

/**
 * What a web process reports, which adds the two shapes in which the worker
 * does not run here at all: `external` when `RUN_WORKER_IN_WEB` is off and a
 * dedicated container is meant to be serving the queues, and `disabled` on a
 * demo instance, which has no queue.
 */
export type ReportedWorkerState = WorkerState | "external" | "disabled";

declare global {
  var __balanciaWorkerState: WorkerState | undefined;
}

export function workerState(): WorkerState {
  return globalThis.__balanciaWorkerState ?? "starting";
}

export function setWorkerState(state: WorkerState): void {
  globalThis.__balanciaWorkerState = state;
}

export function reportedWorkerState(): ReportedWorkerState {
  const env = getEnv();
  if (env.DEMO_MODE) return "disabled";
  if (!env.RUN_WORKER_IN_WEB) return "external";
  return workerState();
}
