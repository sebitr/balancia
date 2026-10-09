import { describe, expect, it } from "vitest";
import { assertEndpointAllowed } from "./endpoint-guard";

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
