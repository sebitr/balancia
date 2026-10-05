// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two moments of a cold arrival the project's own funnel is told about.
 *
 * Everything else the public pages count is a click. An account coming into
 * being is not one — it is the screen after the credential — and the whole
 * flow is a single address, so no page view can say it either. It is said
 * here, once, and only for somebody who arrived with no invitation: every
 * other arrival's address is a token.
 */

const track = vi.fn();

async function freshFunnel() {
  // The once-per-load guard is module state, so each test loads its own.
  vi.resetModules();
  return (await import("./funnel")).recordOnboardingStep;
}

beforeEach(() => {
  track.mockClear();
  (window as unknown as { umami?: unknown }).umami = { track };
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: vi.fn(() => true),
  });
});

describe("what the page counter hears of the onboarding flow", () => {
  it("hears that a cold arrival has an account, at the screen after the credential", async () => {
    const record = await freshFunnel();
    record("cold", "welcome");
    record("cold", "identity");
    expect(track).not.toHaveBeenCalled();

    record("cold", "profile");
    expect(track).toHaveBeenCalledExactlyOnceWith("signup-completed", {});
  });

  it("hears that a cold arrival started a group without one", async () => {
    const record = await freshFunnel();
    record("cold", "startGroup");
    record("cold", "groupLink");
    expect(track).toHaveBeenCalledExactlyOnceWith("guest-group-started", {});
  });

  it("hears it once, however often the screen is come back to", async () => {
    // Back from the first-group screen is the profile screen again. It is
    // the same account.
    const record = await freshFunnel();
    record("cold", "profile");
    record("cold", "firstGroup");
    record("cold", "profile");
    expect(track).toHaveBeenCalledOnce();
  });

  it.each(["personal", "shared"] as const)(
    "hears nothing of a %s arrival, whose address is an invitation",
    async (arrival) => {
      const record = await freshFunnel();
      for (const step of ["welcome", "identity", "profile", "left"] as const) {
        record(arrival, step);
      }
      expect(track).not.toHaveBeenCalled();
    },
  );

  it("is not told about any other screen", async () => {
    const record = await freshFunnel();
    for (const step of [
      "welcome",
      "identity",
      "firstGroup",
      "startGroup",
      "left",
    ] as const) {
      record("cold", step);
    }
    expect(track).not.toHaveBeenCalled();
  });

  it("still counts the screen for the operator when the tracker is not there", async () => {
    // Telemetry off is every instance by default. The local funnel is the
    // operator's own and does not depend on it.
    delete (window as unknown as { umami?: unknown }).umami;
    const record = await freshFunnel();
    expect(() => record("cold", "profile")).not.toThrow();
    expect(navigator.sendBeacon).toHaveBeenCalledOnce();
  });
});
