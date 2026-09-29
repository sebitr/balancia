// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrationNames, migrationsDirectory } from "@/lib/db/migrate";
import { resetEnvCache } from "@/lib/env";
import { setWorkerState, type WorkerState } from "@/lib/jobs/worker-status";
import { GET } from "./route";

/**
 * What readiness says about the worker, and what it lets that decide.
 *
 * The database is a stand-in that answers with whichever migrations a test
 * says are applied. The real one is in tests/integration/readiness.test.ts.
 */
const database = vi.hoisted(() => ({ applied: [] as string[] }));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    execute: async () => ({
      rows: database.applied.map((name) => ({ name })),
    }),
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const BUNDLED = migrationNames(migrationsDirectory());

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://balancia:pw@localhost:5432/balancia");
  vi.stubEnv("AUTH_SECRET", "test-secret-0123456789abcdef0123456789abcdef");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("DEMO_MODE", "");
  vi.stubEnv("RUN_WORKER_IN_WEB", "true");
  resetEnvCache();
  database.applied = [...BUNDLED];
  globalThis.__balanciaWorkerState = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

async function ready() {
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

describe("GET /api/health/ready — the worker", () => {
  it.each<WorkerState>(["starting", "running", "failed", "stopping"])(
    "reports a worker that is %s, and stays ready regardless",
    async (state) => {
      // A web process whose worker is down still serves every page. Failing
      // readiness would take them all away over a stalled queue.
      setWorkerState(state);

      const { status, body } = await ready();

      expect(status).toBe(200);
      expect(body).toMatchObject({ status: "ok", worker: state });
    },
  );

  it("says the worker is elsewhere when RUN_WORKER_IN_WEB is off", async () => {
    vi.stubEnv("RUN_WORKER_IN_WEB", "false");
    resetEnvCache();

    expect((await ready()).body.worker).toBe("external");
  });

  it("says there is no worker on a demo", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    resetEnvCache();

    expect((await ready()).body.worker).toBe("disabled");
  });
});

describe("GET /api/health/ready — the migrations", () => {
  it("is ready when every migration this image carries is applied", async () => {
    const { status, body } = await ready();

    expect(status).toBe(200);
    expect(body).toMatchObject({
      migrations: BUNDLED.length,
      pendingMigrations: 0,
    });
  });

  it("is not ready while one of them is missing", async () => {
    // What an image rolled out ahead of its migrations looks like. "At least
    // one migration has run" used to call this ready, and its first query
    // against a column that did not exist yet was a 500.
    database.applied = BUNDLED.slice(0, -1);

    const { status, body } = await ready();

    expect(status).toBe(503);
    expect(body).toMatchObject({
      status: "starting",
      reason: "migrations-not-applied",
      pendingMigrations: 1,
    });
  });

  it("stays ready on a database that is ahead of this image", async () => {
    // An older image on a newer schema: migrations only ever add.
    database.applied = [...BUNDLED, "9999_from_a_later_release.sql"];

    const { status, body } = await ready();

    expect(status).toBe(200);
    expect(body.pendingMigrations).toBe(0);
  });
});
