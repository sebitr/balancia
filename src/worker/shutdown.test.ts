import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHUTDOWN_DRAIN_MS } from "@/lib/jobs/queue";
import { workerState } from "@/lib/jobs/worker-status";
import { createShutdown, installShutdownHandler } from "./shutdown";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/**
 * The web process's SIGTERM, run by hand. No signal is ever sent: the test
 * runner is a process too, and it would take the hint.
 */

beforeEach(() => {
  globalThis.__balanciaWorkerState = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the shutdown handler", () => {
  it("drains the queue within the budget, then exits as Next would", async () => {
    const stop = vi.fn(async () => {});
    const exit = vi.fn();

    await createShutdown({ stop, exit })("SIGTERM");

    expect(stop).toHaveBeenCalledExactlyOnceWith(SHUTDOWN_DRAIN_MS);
    expect(exit).toHaveBeenCalledExactlyOnceWith(143);
    // Exits only after the drain, never alongside it.
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
      exit.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("runs once, however many signals arrive", async () => {
    // Docker's SIGTERM, then somebody's Ctrl-C while a job is still finishing.
    let finishDrain: () => void = () => {};
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDrain = resolve;
        }),
    );
    const exit = vi.fn();
    const shutdown = createShutdown({ stop, exit });

    const first = shutdown("SIGTERM");
    await shutdown("SIGINT");
    expect(exit).not.toHaveBeenCalled();

    finishDrain();
    await first;
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(143);
  });

  it("tells readiness and the metrics that the worker is stopping", async () => {
    let seen: string | undefined;
    await createShutdown({
      stop: async () => {
        seen = workerState();
      },
      exit: () => {},
    })("SIGINT");

    expect(seen).toBe("stopping");
  });

  it("still exits when the queue refuses to stop cleanly", async () => {
    const exit = vi.fn();

    await createShutdown({
      stop: async () => {
        throw new Error("Connection terminated unexpectedly");
      },
      exit,
    })("SIGINT");

    expect(exit).toHaveBeenCalledExactlyOnceWith(130);
  });
});

describe("installing it", () => {
  function listeners() {
    return {
      SIGTERM: process.listeners("SIGTERM"),
      SIGINT: process.listeners("SIGINT"),
    };
  }

  it("leaves the signals to Next unless Next was told to leave them alone", () => {
    // Without NEXT_MANUAL_SIG_HANDLE, Next's own handler exits the process as
    // soon as the HTTP server closes; a second handler would be a drain that
    // never gets to finish, so none is installed. `next dev` is this case.
    vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "");
    const before = listeners();

    installShutdownHandler();

    expect(listeners()).toEqual(before);
  });

  it("answers both signals when it was", () => {
    vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "true");
    const before = listeners();

    installShutdownHandler();

    const added = {
      SIGTERM: process
        .listeners("SIGTERM")
        .filter((listener) => !before.SIGTERM.includes(listener)),
      SIGINT: process
        .listeners("SIGINT")
        .filter((listener) => !before.SIGINT.includes(listener)),
    };
    try {
      expect(added.SIGTERM).toHaveLength(1);
      expect(added.SIGINT).toHaveLength(1);
    } finally {
      for (const listener of added.SIGTERM) {
        process.removeListener("SIGTERM", listener);
      }
      for (const listener of added.SIGINT) {
        process.removeListener("SIGINT", listener);
      }
    }
  });
});
