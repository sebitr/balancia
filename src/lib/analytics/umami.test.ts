import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENV_VARIABLE_NAMES } from "@/lib/env";

const getEffectiveTelemetry = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telemetry/settings", () => ({ getEffectiveTelemetry }));

const {
  publicPageAnalytics,
  umamiDestination,
  UMAMI_SCRIPT_URL,
  UMAMI_WEBSITE_ID,
} = await import("./umami");

/**
 * The destination, and the consent that decides whether it hears anything.
 *
 * The assertions about the constant look almost too small to write down. They
 * are here because it is the only thing that answers "who is being told", and
 * every promise in `docs/telemetry.md` §17 is a promise about that one
 * hostname. A change to it is a change to all of them, and should have to walk
 * past a failing test to happen quietly.
 */

const ID = "022fe040-106c-41b1-a017-b33516835810";

const telemetry = (over: Record<string, unknown> = {}) => ({
  recording: true,
  transmitting: true,
  crashReporting: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the tracker's address", () => {
  it("is the project's own collector", () => {
    expect(UMAMI_SCRIPT_URL).toBe("https://telemetry.balancia.app/script.js");
  });

  it("is HTTPS, with no room for it not to be", () => {
    // Not a validated setting but a literal, so this is a statement about the
    // source rather than about a parser.
    expect(new URL(UMAMI_SCRIPT_URL).protocol).toBe("https:");
  });

  it("is one host and nothing else", () => {
    const url = new URL(UMAMI_SCRIPT_URL);
    expect(url.hostname).toBe("telemetry.balancia.app");
    expect(url.search).toBe("");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
  });

  it("is the same host telemetry already reports to", () => {
    // The claim this protects is the one an operator can act on: blocking one
    // hostname stops everything Balancia would send, page counts included.
    expect(new URL(UMAMI_SCRIPT_URL).hostname).toBe("telemetry.balancia.app");
  });

  it("cannot be changed by configuration", () => {
    // The property that makes the documentation unconditional: there is no
    // variable an operator, or anyone who reaches the box, can set to point an
    // instance's page views somewhere else — nor one that turns them on.
    expect(
      ENV_VARIABLE_NAMES.filter((name) => name.startsWith("UMAMI")),
    ).toEqual([]);
  });
});

describe("the destination", () => {
  it("is the website compiled in beside the address", () => {
    // Pinned for the same reason the address is: these two lines together are
    // the whole answer to "who is being told", and moving either should have
    // to walk past a failing test.
    expect(UMAMI_WEBSITE_ID).toBe(ID);
    expect(umamiDestination()).toEqual({
      scriptUrl: "https://telemetry.balancia.app/script.js",
      websiteId: ID,
      origin: "https://telemetry.balancia.app",
    });
  });

  it("is nothing when there is no website to report to", () => {
    // A fork that deletes the ID rather than replacing it gets a build that
    // renders no tag and widens no policy, which is the right way round.
    expect(umamiDestination("")).toBeNull();
    expect(umamiDestination("   ")).toBeNull();
  });

  it("refuses an ID that is not the UUID Umami issues", () => {
    // The failure this prevents is silent: Umami takes the request and the
    // data lands under no website, so the symptom is a week of no data.
    expect(umamiDestination("balancia")).toBeNull();
    expect(umamiDestination(ID.slice(0, -1))).toBeNull();
    expect(umamiDestination(`${ID}${ID}`)).toBeNull();
  });

  it("tolerates surrounding whitespace, which a pasted value carries", () => {
    expect(umamiDestination(` ${ID} `)?.websiteId).toBe(ID);
  });

  it("does not ask about consent, because proxy.ts calls it per request", () => {
    umamiDestination(ID);
    expect(getEffectiveTelemetry).not.toHaveBeenCalled();
  });
});

describe("what the public pages actually render", () => {
  /**
   * The gate, called exactly as the pages call it. There is no second opt-in
   * and no environment variable: the administrator's telemetry switch is the
   * whole of it, so an instance that has not opted in loads no tracker and
   * makes no request.
   */
  it("is nothing while telemetry is off", async () => {
    getEffectiveTelemetry.mockResolvedValue(telemetry({ transmitting: false }));
    expect(await publicPageAnalytics()).toBeNull();
  });

  it("is nothing in local mode, where recording happens but nothing leaves", async () => {
    // TELEMETRY_MODE=local promises that nothing is transmitted. Loading a
    // third-party tracker there would break exactly that promise, which is why
    // the gate is `transmitting` and not `recording`.
    getEffectiveTelemetry.mockResolvedValue(
      telemetry({ recording: true, transmitting: false }),
    );
    expect(await publicPageAnalytics()).toBeNull();
  });

  it("is the destination once an administrator has opted in", async () => {
    getEffectiveTelemetry.mockResolvedValue(telemetry({ transmitting: true }));
    expect(await publicPageAnalytics()).toEqual({
      scriptUrl: "https://telemetry.balancia.app/script.js",
      websiteId: ID,
      origin: "https://telemetry.balancia.app",
    });
  });

  it("asks about consent on every call rather than caching its own answer", async () => {
    // getEffectiveTelemetry has a few seconds of its own caching. A second
    // layer here would mean a switch that appears not to take effect.
    getEffectiveTelemetry.mockResolvedValue(telemetry());
    await publicPageAnalytics();
    await publicPageAnalytics();
    expect(getEffectiveTelemetry).toHaveBeenCalledTimes(2);
  });

  it("never asks the database when there is no destination to gate", async () => {
    // Ordering, not an optimisation: a fork that removed the website ID must
    // not query on a stranger's page view to discover it has nowhere to send.
    getEffectiveTelemetry.mockResolvedValue(telemetry());
    expect(await publicPageAnalytics("")).toBeNull();
    expect(getEffectiveTelemetry).not.toHaveBeenCalled();
  });
});
