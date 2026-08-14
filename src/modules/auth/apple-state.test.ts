import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import {
  constantTimeEquals,
  createPendingSignIn,
  decodePendingSignIn,
  encodePendingSignIn,
} from "./apple-state";

/**
 * The sealed value that travels in the Apple state cookie.
 *
 * The signature is the whole point of this module: the callback cannot read
 * the session cookie, so whatever this decodes to is taken at face value —
 * including, for a link ceremony, whose account is about to gain an Apple
 * credential. A payload that can be edited would be a way to attach an Apple
 * account to somebody else's.
 */

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";

function withSecret(secret: string): void {
  process.env.AUTH_SECRET = secret;
  process.env.DATABASE_URL = "postgres://balancia:pw@localhost:5432/balancia";
  process.env.APP_URL = "https://balancia.example.com";
  resetEnvCache();
}

beforeEach(() => {
  withSecret(SECRET);
});

describe("createPendingSignIn", () => {
  it("mints two distinct high-entropy values", () => {
    const pending = createPendingSignIn();

    expect(pending.state).not.toBe(pending.nonce);
    // 32 bytes, base64url — 43 characters with no padding.
    expect(pending.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pending.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pending.linkUserId).toBeUndefined();
  });

  it("never repeats", () => {
    const states = new Set(
      Array.from({ length: 50 }, () => createPendingSignIn().state),
    );
    expect(states.size).toBe(50);
  });

  it("records the account when the ceremony is a link", () => {
    const userId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    expect(createPendingSignIn({ linkUserId: userId }).linkUserId).toBe(userId);
  });
});

describe("encode and decode", () => {
  it("round-trips a sign-in", () => {
    const pending = createPendingSignIn();
    expect(decodePendingSignIn(encodePendingSignIn(pending))).toEqual(pending);
  });

  it("round-trips a link, carrying the account through", () => {
    const pending = createPendingSignIn({
      linkUserId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    });
    expect(decodePendingSignIn(encodePendingSignIn(pending))).toEqual(pending);
  });

  it("refuses a payload whose signature does not cover it", () => {
    const pending = createPendingSignIn();
    const [, signature] = encodePendingSignIn(pending).split(".");

    // Re-point the ceremony at another account, keeping the old signature.
    const forged = Buffer.from(
      JSON.stringify({
        ...pending,
        linkUserId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      }),
      "utf8",
    ).toString("base64url");

    expect(decodePendingSignIn(`${forged}.${signature}`)).toBeNull();
  });

  it("refuses a payload signed with another instance's secret", () => {
    const sealed = encodePendingSignIn(createPendingSignIn());

    withSecret("a-different-secret-0123456789abcdef0123456789");

    expect(decodePendingSignIn(sealed)).toBeNull();
  });

  it("refuses an unsigned payload", () => {
    const payload = Buffer.from(
      JSON.stringify(createPendingSignIn()),
      "utf8",
    ).toString("base64url");

    expect(decodePendingSignIn(payload)).toBeNull();
    expect(decodePendingSignIn(`${payload}.`)).toBeNull();
  });

  it("refuses nonsense without throwing", () => {
    for (const value of [undefined, "", ".", "....", "not-base64url.sig"]) {
      expect(decodePendingSignIn(value)).toBeNull();
    }
  });

  it("refuses a correctly signed payload that is missing a field", () => {
    // Signed by this instance, so the HMAC passes — the schema is the second
    // gate, and it has to hold on its own.
    const sealed = encodePendingSignIn({
      state: "only-a-state",
    } as ReturnType<typeof createPendingSignIn>);

    expect(decodePendingSignIn(sealed)).toBeNull();
  });

  it("refuses a link to something that is not a user ID", () => {
    const sealed = encodePendingSignIn({
      ...createPendingSignIn(),
      linkUserId: "'; drop table users; --",
    });

    expect(decodePendingSignIn(sealed)).toBeNull();
  });
});

describe("constantTimeEquals", () => {
  it("matches identical values and nothing else", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
  });

  it("treats empty as no match, so a missing state never passes", () => {
    expect(constantTimeEquals("", "")).toBe(false);
  });
});
