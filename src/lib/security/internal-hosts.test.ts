import { describe, expect, it } from "vitest";
import { isInternalHost, isSendableEndpoint } from "./internal-hosts";

/**
 * The one outbound request whose destination a user picks.
 *
 * A Web Push endpoint is stored against an account and called by the worker
 * on every notification, so what it is allowed to name is the whole of the
 * question. The cases below are the addresses that are never a push service
 * and always somebody's internal network.
 */
describe("isInternalHost", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.1.2.3", "the rest of 127/8"],
    ["10.0.0.5", "RFC 1918"],
    ["172.16.0.1", "the bottom of 172.16/12"],
    ["172.31.255.254", "the top of 172.16/12"],
    ["192.168.1.1", "RFC 1918"],
    ["169.254.169.254", "the cloud metadata address"],
    ["169.254.0.1", "link-local generally"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["0.0.0.0", "this network"],
    ["198.18.0.1", "benchmarking"],
    ["224.0.0.1", "multicast"],
    ["localhost", "the name"],
    ["app.localhost", "a subdomain of it"],
    ["printer.local", "mDNS"],
    ["thing.home.arpa", "the home network suffix"],
    ["intranet", "a single label, resolved through a search domain"],
    ["[::1]", "IPv6 loopback"],
    ["[::]", "IPv6 unspecified"],
    ["[fe80::1]", "IPv6 link-local"],
    ["[fd00::1]", "IPv6 unique-local"],
    ["[::ffff:127.0.0.1]", "IPv4-mapped loopback"],
    ["", "nothing at all"],
  ])("refuses %s (%s)", (host) => {
    expect(isInternalHost(host)).toBe(true);
  });

  it.each([
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "web.push.apple.com",
    "wns2-par02p.notify.windows.com",
    "8.8.8.8",
    "203.0.113.10",
    "push.example.org",
  ])("allows %s", (host) => {
    expect(isInternalHost(host)).toBe(false);
  });

  /*
   * A leading zero is read as octal by some resolvers and as decimal by
   * others, which is a way of writing 127.0.0.1 that a naive parser waves
   * through. Anything this cannot read confidently is refused rather than
   * guessed at.
   */
  it("refuses an octal-looking address rather than misreading it", () => {
    expect(isInternalHost("0177.0.0.1")).toBe(true);
    expect(isInternalHost("010.0.0.1")).toBe(true);
  });

  it("ignores casing and a trailing root dot", () => {
    expect(isInternalHost("LOCALHOST")).toBe(true);
    expect(isInternalHost("fcm.googleapis.com.")).toBe(false);
  });
});

describe("isSendableEndpoint", () => {
  it("accepts a real push endpoint", () => {
    expect(
      isSendableEndpoint("https://fcm.googleapis.com/fcm/send/abc123:APA91b"),
    ).toBe(true);
  });

  it.each([
    ["http://fcm.googleapis.com/fcm/send/abc", "plain HTTP"],
    ["https://169.254.169.254/latest/meta-data/", "cloud metadata"],
    ["https://10.0.0.5/internal", "a private address"],
    ["https://[::1]:8080/", "IPv6 loopback with a port"],
    ["file:///etc/passwd", "another scheme entirely"],
    ["not a url", "something that will not parse"],
  ])("refuses %s (%s)", (endpoint) => {
    expect(isSendableEndpoint(endpoint)).toBe(false);
  });

  /*
   * The port is not part of the decision — a host is internal or it is not —
   * but it must not confuse the hostname out of the URL either.
   */
  it("reads the host, not the authority", () => {
    expect(isSendableEndpoint("https://push.example.org:8443/x")).toBe(true);
    expect(isSendableEndpoint("https://192.168.0.9:8443/x")).toBe(false);
  });
});
