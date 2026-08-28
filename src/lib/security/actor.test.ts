import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./actor";

/**
 * Which bytes of a request a rate limit may believe.
 *
 * Balancia's credential limits — sign-in, registration, password reset, join
 * redemption — are all keyed on the address this returns. Read the *left* of
 * `X-Forwarded-For` and a caller supplies that address themselves, rotating it
 * per request, and every one of those limits becomes free to walk through.
 * That is what these cases are here to stop coming back.
 */
describe("clientIpFrom", () => {
  const CLIENT = "203.0.113.7";

  it("takes the entry the proxy appended, not the one the caller sent", () => {
    // nginx's $proxy_add_x_forwarded_for on a request that arrived carrying a
    // forged header: the caller's value stays on the left, the real peer is
    // appended on the right.
    expect(clientIpFrom(`198.51.100.1, ${CLIENT}`, null, 1)).toBe(CLIENT);
  });

  it("cannot be moved by adding entries", () => {
    const forged = ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"].join(", ");
    expect(clientIpFrom(`${forged}, ${CLIENT}`, null, 1)).toBe(CLIENT);
  });

  it("reads a plain single-proxy header", () => {
    expect(clientIpFrom(CLIENT, null, 1)).toBe(CLIENT);
  });

  it("counts back past a CDN when told there are two hops", () => {
    // Cloudflare in front of nginx: nginx appends Cloudflare's edge, so the
    // visitor is one further left. Anything left of *that* is still forged.
    const header = `198.51.100.1, ${CLIENT}, 172.16.0.9`;
    expect(clientIpFrom(header, null, 2)).toBe(CLIENT);
  });

  it("stops at the leftmost entry when the chain is shorter than configured", () => {
    // Two hops claimed, one entry present: nothing here came from the caller,
    // so the only entry is the best answer rather than an index out of range.
    expect(clientIpFrom(CLIENT, null, 2)).toBe(CLIENT);
  });

  it("treats a hop count below one as one", () => {
    expect(clientIpFrom(`198.51.100.1, ${CLIENT}`, null, 0)).toBe(CLIENT);
  });

  it("ignores blank entries rather than returning one", () => {
    expect(clientIpFrom(`198.51.100.1, , ${CLIENT}, `, null, 1)).toBe(CLIENT);
  });

  it("falls back to X-Real-IP only when there is no forwarded header", () => {
    expect(clientIpFrom(null, CLIENT, 1)).toBe(CLIENT);
    expect(clientIpFrom("", CLIENT, 1)).toBe(CLIENT);
  });

  it("prefers the forwarded header over X-Real-IP", () => {
    // X-Real-IP is only set by nginx; Caddy and Traefik pass a caller's own
    // through untouched, so it must never outrank the appended list.
    expect(clientIpFrom(`198.51.100.1, ${CLIENT}`, "198.51.100.1", 1)).toBe(
      CLIENT,
    );
  });

  it("says so when the request carries neither header", () => {
    expect(clientIpFrom(null, null, 1)).toBe("unknown");
    expect(clientIpFrom("  ", "  ", 1)).toBe("unknown");
  });
});
