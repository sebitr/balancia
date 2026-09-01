import { appVersion } from "@/lib/telemetry/environment";
import { getRegistry, type Gauge } from "./registry";

/**
 * The metrics Balancia actually keeps, and the helpers that record them.
 *
 * All local, all exact, none transmitted. An operator scrapes them from their
 * own network; a self-hosted installation that scrapes nothing simply never
 * reads them, and the cost of keeping them is a few maps in memory.
 *
 * Every label value here comes from a literal in the source — a route
 * template, a queue name, an outcome — so cardinality is bounded and no
 * identifier can reach a label. That rule is what keeps `/api/metrics` from
 * becoming the leak that telemetry so carefully is not.
 */

/** Seconds. Tuned for a self-hosted app: most work is tens of milliseconds. */
const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
] as const;

/** Longer tail: background jobs and imports are allowed to take a while. */
const JOB_BUCKETS = [0.1, 0.5, 1, 5, 15, 30, 60, 300, 900] as const;

export function httpRequests() {
  return getRegistry().counter(
    "balancia_http_requests_total",
    "HTTP requests handled by a route handler, by route template and status class.",
  );
}

export function httpDuration() {
  return getRegistry().histogram(
    "balancia_http_request_duration_seconds",
    "How long a route handler took, in seconds.",
    DURATION_BUCKETS,
  );
}

export function actionDuration() {
  return getRegistry().histogram(
    "balancia_server_action_duration_seconds",
    "How long a Server Action took, in seconds.",
    DURATION_BUCKETS,
  );
}

export function actionOutcomes() {
  return getRegistry().counter(
    "balancia_server_action_total",
    "Server Actions run, by name and outcome (ok, rejected, failed).",
  );
}

export function rateLimitRefusals() {
  return getRegistry().counter(
    "balancia_rate_limit_refusals_total",
    "Requests refused by a rate limit, by bucket. A signup attack is visible here and nowhere else.",
  );
}

export function jobDuration() {
  return getRegistry().histogram(
    "balancia_job_duration_seconds",
    "How long a background job took, in seconds.",
    JOB_BUCKETS,
  );
}

export function jobOutcomes() {
  return getRegistry().counter(
    "balancia_job_total",
    "Background jobs run, by queue and outcome (ok, failed).",
  );
}

export function databaseQueryDuration() {
  return getRegistry().histogram(
    "balancia_database_query_duration_seconds",
    "How long a database query took, in seconds. No statement text is recorded.",
    DURATION_BUCKETS,
  );
}

/** Seconds since an operation started, for the histograms above. */
export function secondsSince(startedAt: number): number {
  return (performance.now() - startedAt) / 1000;
}

/** `2xx`, `4xx`, `5xx` — enough to alert on, and bounded. */
export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/**
 * Registers the gauges that are read at scrape time rather than written to.
 *
 * Idempotent: the registry returns the metric it already has, and the collect
 * callback is simply replaced.
 */
export function registerRuntimeMetrics(): void {
  const registry = getRegistry();

  registry
    .gauge(
      "balancia_build_info",
      "Always 1; the version label carries the running build.",
    )
    .set(1, { version: appVersion() });

  registry
    .gauge(
      "process_resident_memory_bytes",
      "Resident set size of this process, in bytes.",
    )
    .onCollect((gauge) => gauge.set(process.memoryUsage().rss));

  registry
    .gauge("nodejs_heap_used_bytes", "V8 heap in use, in bytes.")
    .onCollect((gauge) => gauge.set(process.memoryUsage().heapUsed));

  registry
    .gauge(
      "process_cpu_seconds_total",
      "CPU time consumed by this process, in seconds.",
    )
    .onCollect((gauge) => {
      const usage = process.cpuUsage();
      gauge.set((usage.user + usage.system) / 1_000_000);
    });

  registry
    .gauge("process_uptime_seconds", "How long this process has been running.")
    .onCollect((gauge) => gauge.set(process.uptime()));
}

/**
 * The connection-pool gauge.
 *
 * The database client fills this in when it creates the pool, rather than this
 * module reaching for the pool — otherwise the two would import each other,
 * and a cycle between "how we talk to PostgreSQL" and "how we count things" is
 * not worth one gauge.
 */
export function poolConnections(): Gauge {
  return getRegistry().gauge(
    "balancia_database_pool_connections",
    "Connections in the PostgreSQL pool, by state (total, idle, waiting).",
  );
}
