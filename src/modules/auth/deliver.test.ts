import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mail that goes out after the answer has nobody left to tell when it fails.
 * The one thing that must not happen is that it fails quietly.
 */

const deferred = vi.hoisted(() => [] as (() => Promise<void>)[]);
const logged = vi.hoisted(() => vi.fn());

vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => {
    deferred.push(task);
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: logged, info: vi.fn(), warn: vi.fn() },
}));

const { afterResponse } = await import("./deliver");

beforeEach(() => {
  deferred.length = 0;
  logged.mockClear();
});

describe("afterResponse", () => {
  it("does nothing until the response has gone", async () => {
    const work = vi.fn(async () => undefined);

    await afterResponse(work);
    expect(work).not.toHaveBeenCalled();

    await deferred[0]?.();
    expect(work).toHaveBeenCalledOnce();
  });

  it("logs a failure it can no longer report, and swallows it", async () => {
    const failure = new Error(
      "Unable to send email. Check the SMTP configuration.",
    );
    await afterResponse(async () => {
      throw failure;
    });

    await expect(deferred[0]?.()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith({ err: failure }, expect.any(String));
  });
});
