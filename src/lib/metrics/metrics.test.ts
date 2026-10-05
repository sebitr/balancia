import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { setWorkerState } from "@/lib/jobs/worker-status";
import { maintenanceLastSuccess, registerRuntimeMetrics } from "./metrics";
import { getRegistry } from "./registry";

/**
 * The two gauges an operator alerts on when the background jobs go quiet.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://balancia:pw@localhost:5432/balancia");
  vi.stubEnv("AUTH_SECRET", "test-secret-0123456789abcdef0123456789abcdef");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("RUN_WORKER_IN_WEB", "true");
  resetEnvCache();
  getRegistry().clear();
  globalThis.__balanciaWorkerState = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

function scrape(): string {
  registerRuntimeMetrics();
  return getRegistry().render();
}

describe("balancia_worker_up", () => {
  it("is 1 while the worker in this process is serving", () => {
    setWorkerState("running");
    expect(scrape()).toContain("\nbalancia_worker_up 1\n");
  });

  it.each(["starting", "failed", "stopping"] as const)(
    "is 0 while it is %s",
    (state) => {
      setWorkerState(state);
      expect(scrape()).toContain("\nbalancia_worker_up 0\n");
    },
  );

  it("has no sample where the jobs are another process's to run", () => {
    // A 0 here would page somebody about a worker that was never meant to be
    // in this process.
    vi.stubEnv("RUN_WORKER_IN_WEB", "false");
    resetEnvCache();

    expect(scrape()).not.toMatch(/^balancia_worker_up /m);
  });
});

describe("balancia_maintenance_last_success_timestamp_seconds", () => {
  it("is absent until the sweep has run, then says when it finished", () => {
    expect(scrape()).not.toMatch(
      /^balancia_maintenance_last_success_timestamp_seconds /m,
    );

    maintenanceLastSuccess().set(1_790_000_000);

    expect(scrape()).toContain(
      "\nbalancia_maintenance_last_success_timestamp_seconds 1790000000\n",
    );
  });
});
