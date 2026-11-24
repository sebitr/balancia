import { describe, expect, it } from "vitest";
import { assertEndpointAllowed, isMetadataAddress } from "./endpoint-guard";

/**
 * The guard stands between a form field and a nightly outbound connection made
 * with the owner's credentials. The names resolve to whatever the test says,
 * so nothing here touches a network.
 */

const resolving =
  (...addresses: string[]) =>
  async () =>
    addresses;

const strict = (resolve: () => Promise<readonly string[]>) => ({
  allowPrivate: false,
  resolve,
});
const lan = (resolve: () => Promise<readonly string[]>) => ({
  allowPrivate: true,
  resolve,
});

describe("a public server", () => {
  it("is allowed over https", async () => {
    await expect(
      assertEndpointAllowed(
        "https://cloud.example.com/dav",
        strict(resolving("93.184.216.34")),
      ),
    ).resolves.toBeUndefined();
  });

  it("is refused over plain http, which would send the password in the clear", async () => {
    await expect(
      assertEndpointAllowed(
        "http://cloud.example.com/dav",
        strict(resolving("93.184.216.34")),
      ),
    ).rejects.toMatchObject({ code: "endpoint_blocked" });
  });
});

describe("an address inside the network", () => {
  it.each([
    "http://127.0.0.1:8080",
    "http://localhost:9000",
    "https://10.0.0.5",
    "https://192.168.1.20/dav",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://nas/dav",
    "https://nas.local/dav",
  ])("is refused by default: %s", async (url) => {
    await expect(
      assertEndpointAllowed(url, strict(resolving("10.0.0.5"))),
    ).rejects.toMatchObject({ code: "endpoint_blocked" });
  });

  it("is refused when a public-looking name leads inside", async () => {
    await expect(
      assertEndpointAllowed(
        "https://harmless.example.com",
        strict(resolving("93.184.216.34", "10.0.0.5")),
      ),
    ).rejects.toMatchObject({ code: "endpoint_blocked" });
  });

  it("is allowed once the operator allows the local network, even over http", async () => {
    await expect(
      assertEndpointAllowed(
        "http://192.168.1.20:8080/dav",
        lan(resolving("192.168.1.20")),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertEndpointAllowed(
        "http://nas.local/dav",
        lan(resolving("192.168.1.20")),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("the platform's own metadata service", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data",
    "https://[fd00:ec2::254]/",
    "http://metadata.attacker.example/",
  ])("is refused even when the local network is allowed: %s", async (url) => {
    await expect(
      assertEndpointAllowed(url, lan(resolving("169.254.169.254"))),
    ).rejects.toMatchObject({ code: "endpoint_blocked" });
  });

  // Each of these is 169.254.169.254, 100.100.100.200 or a link-local address
  // spelled so that a check on the text would not see it. The resolver answers
  // with a public address, so only the spelling of the host is being judged.
  it.each([
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[0:0:0:0:0:ffff:a9fe:a9fe]/",
    "http://[::a9fe:a9fe]/",
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://[64:ff9b::169.254.169.254]/",
    "http://[fe80::1]/",
    "http://[febf::1]/",
    "http://[FD00:EC2:0:0:0:0:0:254]/",
    "http://100.100.100.200/",
    "http://[::ffff:6464:64c8]/",
    "http://169.254.0.1/",
    "http://2852039166/",
    "http://0xa9fea9fe/",
    "http://0251.0376.0251.0376/",
  ])(
    "is refused however it is spelled, local network allowed or not: %s",
    async (url) => {
      for (const options of [lan, strict]) {
        await expect(
          assertEndpointAllowed(url, options(resolving("93.184.216.34"))),
        ).rejects.toMatchObject({ code: "endpoint_blocked" });
      }
    },
  );

  it.each([
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe",
    "fe80::1",
    "fd00:ec2::254",
    "100.100.100.200",
  ])(
    "is refused when a name resolves to it, local network allowed: %s",
    async (address) => {
      await expect(
        assertEndpointAllowed(
          "http://nas.example.com/",
          lan(resolving("192.168.1.20", address)),
        ),
      ).rejects.toMatchObject({ code: "endpoint_blocked" });
    },
  );

  it("does not take an ordinary address for one, however it is spelled", async () => {
    // 192.168.1.20 and 93.184.216.34, in IPv4-mapped IPv6.
    await expect(
      assertEndpointAllowed(
        "http://[::ffff:c0a8:114]/dav",
        lan(resolving("192.168.1.20")),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertEndpointAllowed(
        "https://[::ffff:5db8:d822]/dav",
        strict(resolving("93.184.216.34")),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("isMetadataAddress", () => {
  it.each([
    "169.254.169.254",
    "169.254.1.1",
    "[::ffff:a9fe:a9fe]",
    "::ffff:169.254.169.254",
    "::a9fe:a9fe",
    "64:ff9b::a9fe:a9fe",
    "fe80::1",
    "[fe80::abcd%eth0]",
    "fd00:ec2::254",
    "100.100.100.200",
    "::ffff:100.100.100.200",
    "not:an:address",
  ])("refuses %s", (value) => {
    expect(isMetadataAddress(value)).toBe(true);
  });

  it.each([
    "93.184.216.34",
    "192.168.1.20",
    "100.100.100.201",
    "::ffff:c0a8:114",
    "::1",
    "fd00:ec2::253",
    "fec0::1",
    "2001:db8::1",
    "cloud.example.com",
  ])("leaves %s to the other checks", (value) => {
    expect(isMetadataAddress(value)).toBe(false);
  });
});

describe("an address that is not an address", () => {
  it.each(["not a url", "ftp://example.com", "file:///etc/passwd", ""])(
    "is refused: %j",
    async (url) => {
      await expect(
        assertEndpointAllowed(url, strict(resolving("93.184.216.34"))),
      ).rejects.toMatchObject({ code: "endpoint_blocked" });
    },
  );

  it("is reported unreachable when the name does not resolve", async () => {
    await expect(
      assertEndpointAllowed(
        "https://no-such-host.example.com",
        strict(async () => {
          throw new Error("ENOTFOUND");
        }),
      ),
    ).rejects.toMatchObject({ code: "unreachable" });
  });
});
