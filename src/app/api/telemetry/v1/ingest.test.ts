import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { limitKey } from "./ingest";

/**
 * The collector's rate-limit key: whose reports it counts together.
 *
 * It is the one limit that answers strangers by design, so it is the last
 * place that can afford to believe what a stranger wrote. It used to take the
 * leftmost `X-Forwarded-For` entry — the sender's own — and a sender could
 * be somebody new on every request.
 */

const NOW = new Date("2026-09-29T12:00:00Z");

function withProxyHops(hops: number): void {
  process.env.AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
  process.env.DATABASE_URL = "postgres://balancia:pw@localhost:5432/balancia";
  process.env.APP_URL = "https://telemetry.example.org";
  process.env.TRUSTED_PROXY_HOPS = String(hops);
  resetEnvCache();
}

function keyFor(forwardedFor: string, now = NOW): string {
  return limitKey(new Headers({ "x-forwarded-for": forwardedFor }), now);
}

beforeEach(() => {
  withProxyHops(1);
});

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
  resetEnvCache();
});

describe("the collector's limit key", () => {
  const SENDER = "203.0.113.7";

  it("counts the address the proxy appended, not the one the sender wrote", () => {
    const honest = keyFor(SENDER);

    for (const forged of ["198.51.100.1", "1.1.1.1, 2.2.2.2", "10.0.0.1"]) {
      expect(keyFor(`${forged}, ${SENDER}`)).toBe(honest);
    }
  });

  it("keeps two senders apart", () => {
    expect(keyFor("203.0.113.7")).not.toBe(keyFor("203.0.113.8"));
  });

  it("counts back past a CDN when told there are two hops", () => {
    withProxyHops(2);
    expect(keyFor(`198.51.100.1, ${SENDER}, 172.16.0.9`)).toBe(
      keyFor(`${SENDER}, 172.16.0.2`),
    );
  });

  it("counts one IPv6 subscriber once, however it rotates", () => {
    expect(keyFor("2001:db8:1:2::a")).toBe(
      keyFor("2001:db8:1:2:dead:beef:0:1"),
    );
    expect(keyFor("2001:db8:1:2::a")).not.toBe(keyFor("2001:db8:1:3::a"));
  });

  it("counts an IPv4 sender the same over a dual-stack socket", () => {
    expect(keyFor(`::ffff:${SENDER}`)).toBe(keyFor(SENDER));
  });

  it("is a digest, never the address", () => {
    expect(keyFor(SENDER)).toMatch(/^[0-9a-f]{32}$/);
    expect(keyFor("2001:db8:1:2::a")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes with the UTC day, so no key outlives it", () => {
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(keyFor(SENDER, tomorrow)).not.toBe(keyFor(SENDER));
  });
});
