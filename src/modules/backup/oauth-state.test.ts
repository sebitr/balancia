import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import {
  decodePending,
  encodePending,
  sameState,
  ttlExpiry,
  type PendingConnection,
} from "./oauth-state";

/**
 * The cookie is what stands between a stranger's authorization code and this
 * person's account, so the tests are about what it must refuse: another
 * person's, an old one, an edited one, and one for a different provider.
 */

const NOW = Date.UTC(2026, 9, 9, 3, 30);

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
  process.env.DATABASE_URL = "postgres://balancia:pw@localhost:5432/balancia";
  process.env.APP_URL = "https://balancia.example.com";
  resetEnvCache();
});

const pending: PendingConnection = {
  kind: "google",
  state: "state-value",
  verifier: "verifier-value",
  userId: "7b0f6f5e-0000-4000-8000-000000000001",
  expiresAt: NOW + 600_000,
};

describe("the pending connection", () => {
  it("survives the trip to the provider and back", () => {
    expect(decodePending(encodePending(pending), NOW)).toEqual({
      ...pending,
      reconnectId: undefined,
    });
  });

  it("carries a reconnect target through", () => {
    const withTarget = { ...pending, reconnectId: "d1" };

    expect(decodePending(encodePending(withTarget), NOW)?.reconnectId).toBe(
      "d1",
    );
  });

  it("cannot be read from outside: the verifier is not in the clear", () => {
    const sealed = encodePending(pending);

    expect(sealed).not.toContain("verifier-value");
    expect(sealed).not.toContain(pending.userId);
  });

  describe("carrying a person's own app", () => {
    const app = { clientId: "mine.apps.example", clientSecret: "my-secret-9" };

    it("brings the app back from the trip", () => {
      const sealed = encodePending({ ...pending, app });

      expect(decodePending(sealed, NOW)?.app).toEqual(app);
    });

    it("keeps the secret out of the cookie's readable part", () => {
      const sealed = encodePending({ ...pending, app });

      expect(sealed).not.toContain("my-secret-9");
      expect(sealed).not.toContain("mine.apps.example");
    });

    it("has no app when the trip was made through the server's", () => {
      expect(decodePending(encodePending(pending), NOW)?.app).toBeUndefined();
    });

    it("drops half an app rather than signing with it", async () => {
      const { seal } = await import("@/lib/security/secret-box");
      const half = seal(
        "backup-oauth-state",
        JSON.stringify({ ...pending, app: { clientId: "only-an-id" } }),
      );

      expect(decodePending(half, NOW)?.app).toBeUndefined();
    });

    it("drops an app with something in it that rclone or a token request could not carry", async () => {
      const { seal } = await import("@/lib/security/secret-box");
      const forged = seal(
        "backup-oauth-state",
        JSON.stringify({
          ...pending,
          app: { clientId: "id", clientSecret: "two words\nline" },
        }),
      );

      expect(decodePending(forged, NOW)?.app).toBeUndefined();
    });
  });

  it("expires", () => {
    expect(decodePending(encodePending(pending), NOW + 601_000)).toBeNull();
  });

  it("rejects a cookie somebody edited", () => {
    const sealed = encodePending(pending);
    const edited = sealed.slice(0, -4) + "AAAA";

    expect(decodePending(edited, NOW)).toBeNull();
  });

  it("rejects a cookie sealed for another purpose", async () => {
    const { seal } = await import("@/lib/security/secret-box");

    expect(
      decodePending(seal("backup-destination", JSON.stringify(pending)), NOW),
    ).toBeNull();
  });

  it("rejects one that names a provider this feature does not have", async () => {
    const { seal } = await import("@/lib/security/secret-box");
    const forged = seal(
      "backup-oauth-state",
      JSON.stringify({ ...pending, kind: "evil" }),
    );

    expect(decodePending(forged, NOW)).toBeNull();
  });

  it("rejects nothing, garbage and a missing cookie alike", () => {
    expect(decodePending(undefined, NOW)).toBeNull();
    expect(decodePending("", NOW)).toBeNull();
    expect(decodePending("not-a-cookie", NOW)).toBeNull();
  });

  it("lasts ten minutes from when it is set", () => {
    expect(ttlExpiry(NOW)).toBe(NOW + 600_000);
  });
});

describe("sameState", () => {
  it("accepts the same value and nothing else", () => {
    expect(sameState("abc", "abc")).toBe(true);
    expect(sameState("abc", "abd")).toBe(false);
    expect(sameState("abc", "abcd")).toBe(false);
    expect(sameState("abc", "")).toBe(false);
  });
});
