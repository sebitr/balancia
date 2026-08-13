import { beforeEach, describe, expect, it } from "vitest";
import { verify } from "node:crypto";
import {
  assertValidKeyPair,
  audienceFor,
  authorizationFor,
  resetTokenCache,
  signToken,
  type VapidKeyPair,
} from "./vapid";
import {
  generateKeyPair,
  publicKeyObject,
  PushKeyError,
  toBase64Url,
} from "./keys";

function newKeyPair(subject = "mailto:admin@example.com"): VapidKeyPair {
  return { ...generateKeyPair(), subject };
}

/** Splits `vapid t=<jwt>, k=<key>` back into its two parts. */
function parseAuthorization(header: string) {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  expect(match).not.toBeNull();
  const [, token, key] = match!;
  const [header64, payload64, signature64] = token.split(".");
  return {
    key,
    token,
    signingInput: `${header64}.${payload64}`,
    header: JSON.parse(Buffer.from(header64, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(payload64, "base64url").toString("utf8")),
    signature: Buffer.from(signature64, "base64url"),
  };
}

beforeEach(() => {
  resetTokenCache();
});

describe("assertValidKeyPair", () => {
  it("accepts a matching pair", () => {
    expect(() => assertValidKeyPair(newKeyPair())).not.toThrow();
  });

  it("rejects halves that come from different pairs", () => {
    const first = newKeyPair();
    const second = newKeyPair();

    expect(() =>
      assertValidKeyPair({ ...first, privateKey: second.privateKey }),
    ).toThrow(/not the public half/);
  });

  it("rejects a subject that is neither mailto: nor https:", () => {
    expect(() => assertValidKeyPair(newKeyPair("admin@example.com"))).toThrow(
      /mailto:/,
    );
  });

  it("rejects a private key of the wrong length", () => {
    const keys = newKeyPair();
    expect(() =>
      assertValidKeyPair({
        ...keys,
        privateKey: toBase64Url(Buffer.alloc(16)),
      }),
    ).toThrow(/32 bytes/);
  });
});

describe("audienceFor", () => {
  it("keeps the origin and drops the subscription path", () => {
    expect(
      audienceFor("https://fcm.googleapis.com/fcm/send/abc123:long-token"),
    ).toBe("https://fcm.googleapis.com");
  });

  it("refuses a non-HTTPS endpoint", () => {
    expect(() => audienceFor("http://push.example.com/x")).toThrow(
      PushKeyError,
    );
  });

  it("refuses something that is not a URL", () => {
    expect(() => audienceFor("not-a-url")).toThrow(PushKeyError);
  });
});

describe("signToken", () => {
  it("signs an ES256 JWT the matching public key verifies", () => {
    const keys = newKeyPair();

    const parsed = parseAuthorization(
      signToken(keys, "https://push.example.com").authorization,
    );

    expect(parsed.header).toEqual({ typ: "JWT", alg: "ES256" });
    expect(parsed.key).toBe(keys.publicKey);
    // 64 raw bytes (r‖s), not a DER sequence — what JOSE requires.
    expect(parsed.signature).toHaveLength(64);
    expect(
      verify(
        "sha256",
        Buffer.from(parsed.signingInput, "ascii"),
        {
          key: publicKeyObject(Buffer.from(keys.publicKey, "base64url")),
          dsaEncoding: "ieee-p1363",
        },
        parsed.signature,
      ),
    ).toBe(true);
  });

  it("claims the audience, the subject and an expiry inside 24 hours", () => {
    const keys = newKeyPair();
    const now = new Date("2026-08-13T10:00:00Z");

    const parsed = parseAuthorization(
      signToken(keys, "https://push.example.com", now).authorization,
    );

    expect(parsed.payload.aud).toBe("https://push.example.com");
    expect(parsed.payload.sub).toBe("mailto:admin@example.com");
    const lifetime = parsed.payload.exp - Math.floor(now.getTime() / 1000);
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it("carries no claim about the recipient", () => {
    const keys = newKeyPair();

    const parsed = parseAuthorization(
      signToken(keys, "https://push.example.com").authorization,
    );

    expect(Object.keys(parsed.payload).sort()).toEqual(["aud", "exp", "sub"]);
  });
});

describe("authorizationFor", () => {
  it("reuses one token across endpoints on the same push service", () => {
    const keys = newKeyPair();

    const first = authorizationFor(keys, "https://push.example.com/one");
    const second = authorizationFor(keys, "https://push.example.com/two");

    expect(second).toBe(first);
  });

  it("signs a separate token per push service", () => {
    const keys = newKeyPair();

    const google = authorizationFor(keys, "https://fcm.googleapis.com/x");
    const mozilla = authorizationFor(
      keys,
      "https://updates.push.services.mozilla.com/y",
    );

    expect(google).not.toBe(mozilla);
    expect(parseAuthorization(google).payload.aud).toBe(
      "https://fcm.googleapis.com",
    );
    expect(parseAuthorization(mozilla).payload.aud).toBe(
      "https://updates.push.services.mozilla.com",
    );
  });

  it("re-signs once the cached token is close to expiring", () => {
    const keys = newKeyPair();
    const start = new Date("2026-08-13T10:00:00Z");

    const first = authorizationFor(keys, "https://push.example.com/x", start);
    // Eleven and a half hours later the 12-hour token is inside the renewal
    // window, so a fresh one must be issued rather than nearly-expired.
    const later = new Date(start.getTime() + 11.5 * 60 * 60 * 1000);
    const second = authorizationFor(keys, "https://push.example.com/x", later);

    expect(second).not.toBe(first);
    expect(parseAuthorization(second).payload.exp).toBeGreaterThan(
      parseAuthorization(first).payload.exp,
    );
  });
});
