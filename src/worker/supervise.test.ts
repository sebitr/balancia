import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { setWorkerState, workerState } from "@/lib/jobs/worker-status";
import { MAX_RETRY_MS, retryDelayMs, superviseWorker } from "./supervise";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/**
 * The in-web worker's second, third and hundredth chances.
 *
 * Nothing here waits for real: `wait` is handed in, so a test can see the
 * whole backoff schedule go by without sitting through any of it.
 */

beforeEach(() => {
  globalThis.__balanciaWorkerState = undefined;
  vi.mocked(logger.error).mockClear();
});

/** A start that fails `times` times, then succeeds. */
function failing(times: number) {
  let left = times;
  return vi.fn(async () => {
    if (left > 0) {
      left -= 1;
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    }
  });
}

describe("the backoff schedule", () => {
  it("doubles from five seconds and stops at five minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 50].map(retryDelayMs)).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ]);
    expect(MAX_RETRY_MS).toBe(300_000);
  });
});

describe("superviseWorker", () => {
  it("keeps trying until the worker starts, waiting longer each time", async () => {
    const start = failing(3);
    const stop = vi.fn(async () => {});
    const waits: number[] = [];

    await superviseWorker({
      start,
      stop,
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    expect(start).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([5_000, 10_000, 20_000]);
    expect(workerState()).toBe("running");
  });

  it("clears away each failed attempt before the next one", async () => {
    // A start can fail after some queues are already subscribed; trying again
    // on top of that would subscribe them twice.
    const stop = vi.fn(async () => {});

    await superviseWorker({ start: failing(2), stop, wait: async () => {} });

    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("says it has failed while it is waiting to try again", async () => {
    const states: string[] = [];

    await superviseWorker({
      start: failing(1),
      stop: async () => {},
      wait: async () => {
        states.push(workerState());
      },
    });

    expect(states).toEqual(["failed"]);
    expect(workerState()).toBe("running");
  });

  it("logs each failure once", async () => {
    await superviseWorker({
      start: failing(3),
      stop: async () => {},
      wait: async () => {},
    });

    expect(logger.error).toHaveBeenCalledTimes(3);
    expect(vi.mocked(logger.error).mock.calls[2]?.[0]).toMatchObject({
      attempt: 3,
      retryInSeconds: 20,
    });
  });

  it("stops trying once the process is shutting down", async () => {
    const start = failing(Number.POSITIVE_INFINITY);

    await superviseWorker({
      start,
      stop: async () => {},
      wait: async () => {
        setWorkerState("stopping");
      },
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(workerState()).toBe("stopping");
  });

  it("never rejects, whatever the start throws", async () => {
    const start = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce("not even an Error")
      .mockResolvedValueOnce(undefined);

    await expect(
      superviseWorker({
        start,
        stop: async () => {
          throw new Error("and the cleanup failed too");
        },
        wait: async () => {},
      }),
    ).resolves.toBeUndefined();
    expect(workerState()).toBe("running");
  });
});
