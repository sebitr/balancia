import { describe, expect, it } from "vitest";
import { rateLimitAddress } from "./client-address";

/**
 * How much of an address a rate limit counts.
 *
 * Every limit keyed on a client address was, for an IPv6 client, a limit it
 * could step out of by changing the last sixty-four bits — which its own
 * operating system does unprompted. These cases hold the /64 in place, and
 * hold everything that is not an address exactly where it was.
 */
describe("rateLimitAddress", () => {
  it("counts an IPv6 address by its /64", () => {
    expect(rateLimitAddress("2001:db8:1234:5678:9abc:def0:1234:5678")).toBe(
      "2001:db8:1234:5678::/64",
    );
  });

  it("puts every address in one /64 in one bucket", () => {
    const rotated = [
      "2001:db8:aa:bb::1",
      "2001:db8:aa:bb:ffff:ffff:ffff:ffff",
      "2001:0DB8:00AA:00BB:1:2:3:4",
    ].map(rateLimitAddress);

    expect(new Set(rotated)).toEqual(new Set(["2001:db8:aa:bb::/64"]));
  });

  it("keeps neighbouring /64s apart", () => {
    expect(rateLimitAddress("2001:db8:aa:bb::1")).not.toBe(
      rateLimitAddress("2001:db8:aa:bc::1"),
    );
  });

  it("reads the compressed forms", () => {
    expect(rateLimitAddress("::")).toBe("0:0:0:0::/64");
    expect(rateLimitAddress("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitAddress("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(rateLimitAddress("2001:db8::7:8")).toBe("2001:db8:0:0::/64");
    expect(rateLimitAddress("1:2:3:4:5:6:7::")).toBe("1:2:3:4::/64");
    expect(rateLimitAddress("fe80::1:2:3:4")).toBe("fe80:0:0:0::/64");
  });

  it("counts an IPv4 address written as IPv6 as the IPv4 address", () => {
    // A dual-stack socket reports an IPv4 peer this way. Left alone it would
    // be one client holding two allowances, one per spelling.
    expect(rateLimitAddress("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(rateLimitAddress("::FFFF:192.0.2.1")).toBe("192.0.2.1");
    expect(rateLimitAddress("::ffff:c000:201")).toBe("192.0.2.1");
    expect(rateLimitAddress("0:0:0:0:0:ffff:192.0.2.1")).toBe("192.0.2.1");
  });

  it("leaves an IPv4 address as it is", () => {
    expect(rateLimitAddress("192.0.2.1")).toBe("192.0.2.1");
    expect(rateLimitAddress("127.0.0.1")).toBe("127.0.0.1");
  });

  it("ignores a zone id", () => {
    expect(rateLimitAddress("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitAddress("fe80::2%en1")).toBe(rateLimitAddress("fe80::3"));
  });

  it("takes an address out of brackets, with or without a port", () => {
    expect(rateLimitAddress("[2001:db8:1:2::9]")).toBe("2001:db8:1:2::/64");
    expect(rateLimitAddress("[2001:db8:1:2::9]:443")).toBe("2001:db8:1:2::/64");
    expect(rateLimitAddress("[::ffff:192.0.2.1]:8080")).toBe("192.0.2.1");
  });

  it("returns anything that is not an address untouched", () => {
    for (const value of [
      "unknown",
      "",
      ":",
      ":::",
      "1::2::3",
      "1:2:3:4:5:6:7:8:9",
      "1:2:3:4:5:6:7",
      "12345::1",
      "g::1",
      "::ffff:192.0.2",
      "::ffff:192.0.2.256",
      "192.0.2.1::",
      "192.0.2.1:8080",
      "[2001:db8::1",
      // The other things buckets are keyed on. None of them may be folded
      // into an address's block.
      "ada@example.test",
      "8c7f1b52-3d7a-4c7e-9a41-6f0c2d9e8b11",
      "0123456789abcdef0123456789abcdef",
      "server:TypeError",
      "instance",
    ]) {
      expect(rateLimitAddress(value), value).toBe(value);
    }
  });
});
