import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Starting and stopping the queue, with pg-boss replaced by a stand-in that
 * does what it is told: fail to start, stop at once, or never settle.
 */
const pgBoss = vi.hoisted(() => {
  const state = {
    /** How many of the next `start()` calls reject. */
    failingStarts: 0,
    /** What `stop()` does; resolving at once unless a test says otherwise. */
    stop: async (): Promise<void> => {},
    instances: [] as {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    }[],
  };

  class FakeBoss {
    readonly start = vi.fn(async () => {
      if (state.failingStarts > 0) {
        state.failingStarts -= 1;
        throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
      }
    });
    readonly stop = vi.fn<(options: unknown) => Promise<void>>(() =>
      state.stop(),
    );
    readonly createQueue = vi.fn(async () => {});
    readonly on = vi.fn();

    constructor() {
      state.instances.push(this);
    }
  }

  return { state, FakeBoss };
});

vi.mock("pg-boss", () => ({ PgBoss: pgBoss.FakeBoss }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/** A fresh copy of the module each time: `getBoss` caches in module state. */
async function loadQueue() {
  vi.resetModules();
  return import("./queue");
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://balancia:pw@localhost:5432/balancia");
  vi.stubEnv("AUTH_SECRET", "test-secret-0123456789abcdef0123456789abcdef");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("DEMO_MODE", "");
  pgBoss.state.failingStarts = 0;
  pgBoss.state.stop = async () => {};
  pgBoss.state.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("getBoss", () => {
  it("tries again after a failed start instead of repeating the failure", async () => {
    // The database answering a few seconds after the app is an ordinary boot.
    // A cached rejection turned that into no queue until the next restart.
    const { getBoss } = await loadQueue();
    pgBoss.state.failingStarts = 1;

    await expect(getBoss()).rejects.toThrow("ECONNREFUSED");
    const boss = await getBoss();

    expect(boss).toBe(pgBoss.state.instances[1]);
    expect(pgBoss.state.instances).toHaveLength(2);
    // And once it has started, it stays started.
    expect(await getBoss()).toBe(boss);
  });

  it("stops what a failed start left half open", async () => {
    const { getBoss } = await loadQueue();
    pgBoss.state.failingStarts = 1;

    await expect(getBoss()).rejects.toThrow();

    expect(pgBoss.state.instances[0]?.stop).toHaveBeenCalledWith({
      graceful: false,
      close: true,
    });
  });

  it("hands concurrent callers the same start", async () => {
    const { getBoss } = await loadQueue();

    const [first, second] = await Promise.all([getBoss(), getBoss()]);

    expect(first).toBe(second);
    expect(pgBoss.state.instances).toHaveLength(1);
  });
});
