import { readFileSync } from "node:fs";
import path from "node:path";
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

describe("stopBoss", () => {
  it("drains within the shutdown budget, then returns as soon as pg-boss has stopped", async () => {
    // pg-boss's stop() resolves only when everything is done. Waiting for its
    // `stopped` event afterwards — as this used to — waited for an event that
    // had already fired, and sat out a thirty-five-second timer every time.
    const { getBoss, stopBoss, SHUTDOWN_DRAIN_MS } = await loadQueue();
    await getBoss();

    const startedAt = Date.now();
    await stopBoss();

    expect(pgBoss.state.instances[0]?.stop).toHaveBeenCalledWith({
      graceful: true,
      close: true,
      timeout: SHUTDOWN_DRAIN_MS,
    });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("gives up on a queue that never settles once the budget and the slack are spent", async () => {
    const { getBoss, stopBoss, SHUTDOWN_DRAIN_MS, STOP_SLACK_MS } =
      await loadQueue();
    await getBoss();
    pgBoss.state.stop = () => new Promise(() => {});
    vi.useFakeTimers();

    let stopped = false;
    const stopping = stopBoss().then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(SHUTDOWN_DRAIN_MS + STOP_SLACK_MS - 1);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(stopped).toBe(true);
  });

  it("starts a new queue afterwards rather than handing back the stopped one", async () => {
    const { getBoss, stopBoss } = await loadQueue();
    const first = await getBoss();

    await stopBoss();

    expect(await getBoss()).not.toBe(first);
  });
});

/**
 * The seconds a Compose file allows between SIGTERM and SIGKILL, for one
 * service. Read as text, like env.test.ts reads compose.yaml: the files are
 * simple enough, and a YAML parser is not a dependency worth one assertion.
 */
function gracePeriodSeconds(file: string, service: string): number {
  const source = readFileSync(path.join(process.cwd(), file), "utf8");
  const start = source.indexOf(`\n  ${service}:\n`);
  expect(start, `${file} should define the ${service} service`).toBeGreaterThan(
    -1,
  );
  const rest = source.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  const block = next === -1 ? rest : rest.slice(0, next + 1);
  const match = /\n {4}stop_grace_period: (\d+)s\n/.exec(block);
  expect(match, `${file} should give ${service} a stop_grace_period`).not.toBe(
    null,
  );
  return Number(match?.[1]);
}

describe("the drain fits inside every grace period", () => {
  it.each([
    ["compose.yaml", "app"],
    ["compose.yaml", "worker"],
    ["compose.dev.yaml", "worker"],
  ])("%s gives %s long enough to drain and close", async (file, service) => {
    // Past the grace period Docker sends SIGKILL, and a job still running
    // then is neither finished nor handed back: it sits as active until it
    // expires. The drain and pg-boss's own close must both fit, with time
    // left over for the process to exit.
    const { SHUTDOWN_DRAIN_MS, STOP_SLACK_MS } = await loadQueue();
    expect(gracePeriodSeconds(file, service) * 1000).toBeGreaterThan(
      SHUTDOWN_DRAIN_MS + STOP_SLACK_MS,
    );
  });
});
