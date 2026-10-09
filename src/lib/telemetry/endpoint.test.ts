import { describe, expect, it } from "vitest";
import { UMAMI_SCRIPT_URL } from "@/lib/analytics/umami";
import { ENV_VARIABLE_NAMES } from "@/lib/env";
import { TELEMETRY_ENDPOINT } from "./endpoint";

/**
 * The destination, held to what the documentation says about it.
 *
 * These assertions look almost too small to write down. They are here because
 * the endpoint is the one value in the whole system that decides *who* hears
 * from an installation, and because every promise in `docs/telemetry.md` is a
 * promise about this specific address. A change to it is a change to all of
 * them, and should have to walk past a failing test to happen quietly.
 */

describe("the telemetry endpoint", () => {
  it("is the project's collector", () => {
    expect(TELEMETRY_ENDPOINT).toBe("https://balancia.app");
  });

  it("is not the host Umami runs on", () => {
    // That host answers 404 to `/v1/report`, so a report sent there is never
    // collected. Two services cannot share one hostname unless something
    // routes between them, and nothing in this repository does.
    expect(new URL(TELEMETRY_ENDPOINT).hostname).not.toBe(
      new URL(UMAMI_SCRIPT_URL).hostname,
    );
  });

  it("is HTTPS, with no room for it not to be", () => {
    // Not a validated setting but a literal, so this is a statement about the
    // source rather than about a parser.
    expect(new URL(TELEMETRY_ENDPOINT).protocol).toBe("https:");
  });

  it("is one host and nothing else", () => {
    const url = new URL(TELEMETRY_ENDPOINT);
    expect(url.hostname).toBe("balancia.app");
    expect(url.search).toBe("");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
  });

  it("cannot be changed by configuration", () => {
    // The property that makes the rest of the documentation unconditional:
    // there is no variable an operator, an administrator or anyone who reaches
    // the box can set to point an instance somewhere else.
    //
    // Scoped to telemetry: `S3_ENDPOINT` and `EXCHANGE_RATE_API_URL` are
    // addresses an operator is *supposed* to choose, because they are the
    // operator's own services.
    expect(ENV_VARIABLE_NAMES).not.toContain("TELEMETRY_ENDPOINT");
    expect(
      ENV_VARIABLE_NAMES.filter(
        (name) =>
          name.startsWith("TELEMETRY_") &&
          /ENDPOINT|URL|HOST|COLLECTOR/.test(name),
      ),
    ).toEqual([]);
  });
});
