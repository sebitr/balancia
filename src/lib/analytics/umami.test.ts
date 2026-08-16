import { describe, expect, it } from "vitest";
import { readUmamiConfig, umamiConfigError } from "./umami";

/**
 * The settings, and the two ways they are usually wrong.
 *
 * Analytics that are half-configured are worse than analytics that are off,
 * because both look identical from the outside: an empty dashboard, no error,
 * and no reason to suspect the configuration rather than the traffic.
 */

const SCRIPT = "https://analytics.example.com/script.js";
const ID = "6f8b3a1c-2d4e-4f60-9a71-8c5d2e0f4b93";

const env = (over: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ ...over }) as NodeJS.ProcessEnv;

describe("reading the configuration", () => {
  it("is off when neither setting is given", () => {
    expect(readUmamiConfig(env())).toBeNull();
  });

  it("is off when the variables are present but empty", () => {
    // compose.yaml passes optional settings through as `${VAR:-}`, so on an
    // instance that configured nothing both arrive as empty strings rather
    // than not at all.
    expect(
      readUmamiConfig(env({ UMAMI_SCRIPT_URL: "", UMAMI_WEBSITE_ID: "" })),
    ).toBeNull();
  });

  it("reads both values and derives the origin from the script URL", () => {
    const config = readUmamiConfig(
      env({ UMAMI_SCRIPT_URL: SCRIPT, UMAMI_WEBSITE_ID: ID }),
    );
    expect(config).toEqual({
      scriptUrl: SCRIPT,
      websiteId: ID,
      origin: "https://analytics.example.com",
    });
  });

  it("keeps a port in the derived origin", () => {
    // The origin goes into connect-src, where a missing port is a blocked
    // request rather than a loose one.
    const config = readUmamiConfig(
      env({
        UMAMI_SCRIPT_URL: "https://analytics.example.com:8443/script.js",
        UMAMI_WEBSITE_ID: ID,
      }),
    );
    expect(config?.origin).toBe("https://analytics.example.com:8443");
  });

  it("stays off rather than half-on when the configuration is invalid", () => {
    // The schema refuses to boot on these, so this is the belt to that
    // braces: `proxy.ts` reads the raw environment on every request and must
    // never widen the policy on the strength of a value nothing accepted.
    expect(
      readUmamiConfig(
        env({ UMAMI_SCRIPT_URL: "not-a-url", UMAMI_WEBSITE_ID: ID }),
      ),
    ).toBeNull();
    expect(
      readUmamiConfig(env({ UMAMI_SCRIPT_URL: SCRIPT, UMAMI_WEBSITE_ID: "" })),
    ).toBeNull();
  });
});

describe("what startup rejects", () => {
  it("accepts nothing at all", () => {
    expect(umamiConfigError(undefined, undefined)).toBeNull();
    expect(umamiConfigError("", "")).toBeNull();
  });

  it("accepts a complete pair", () => {
    expect(umamiConfigError(SCRIPT, ID)).toBeNull();
  });

  it("names the missing half, either way round", () => {
    expect(umamiConfigError(SCRIPT, undefined)?.path).toBe("UMAMI_WEBSITE_ID");
    expect(umamiConfigError(undefined, ID)?.path).toBe("UMAMI_SCRIPT_URL");
  });

  it("refuses a relative or malformed URL", () => {
    expect(umamiConfigError("/script.js", ID)?.path).toBe("UMAMI_SCRIPT_URL");
    expect(umamiConfigError("analytics.example.com", ID)?.message).toMatch(
      /absolute URL/,
    );
  });

  it("refuses plain HTTP outside localhost", () => {
    // `upgrade-insecure-requests` rewrites it to https:// on a real install,
    // so this would be a script that silently never loads.
    expect(
      umamiConfigError("http://analytics.example.com/script.js", ID)?.message,
    ).toMatch(/HTTPS/);
  });

  it("permits plain HTTP on localhost, where a dev Umami lives", () => {
    for (const url of [
      "http://localhost:3001/script.js",
      "http://127.0.0.1:3001/script.js",
      "http://umami.localhost/script.js",
    ]) {
      expect(umamiConfigError(url, ID), url).toBeNull();
    }
  });

  it("refuses a scheme that is not http or https", () => {
    expect(umamiConfigError("ftp://analytics.example.com/s.js", ID)).not.toBe(
      null,
    );
  });

  it("refuses a website ID that is not the UUID Umami issues", () => {
    // The failure this prevents is silent: Umami takes the request and the
    // data lands under no website.
    expect(umamiConfigError(SCRIPT, "balancia")?.path).toBe("UMAMI_WEBSITE_ID");
    expect(umamiConfigError(SCRIPT, ID.slice(0, -1))?.path).toBe(
      "UMAMI_WEBSITE_ID",
    );
  });

  it("tolerates surrounding whitespace, which a pasted value carries", () => {
    expect(umamiConfigError(` ${SCRIPT} `, ` ${ID} `)).toBeNull();
  });
});
