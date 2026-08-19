import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { open, seal } from "./secret-box";

/**
 * The one place a stored secret is meant to come back.
 *
 * What is asserted is the shape of the guarantee rather than the ciphertext:
 * the value returns for the purpose it was sealed under and for nothing else,
 * a row somebody edited does not open, and a rotated `AUTH_SECRET` reads as
 * "gone" rather than as a crash — because the caller's job in all three cases
 * is the same, and it is to offer a new link.
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

describe("seal", () => {
  it("returns the value it was given", () => {
    expect(open("join-link", seal("join-link", "a-token"))).toBe("a-token");
  });

  it("never produces the same ciphertext twice", () => {
    const first = seal("join-link", "a-token");
    const second = seal("join-link", "a-token");

    expect(first).not.toBe(second);
    // A repeated nonce under one key is what breaks GCM, so this matters more
    // than it looks: both still open, and they do not look alike.
    expect(open("join-link", first)).toBe(open("join-link", second));
  });

  it("keeps the plaintext out of the stored form", () => {
    expect(seal("join-link", "a-token")).not.toContain("a-token");
  });
});

describe("open", () => {
  it("refuses a value sealed for another purpose", () => {
    expect(open("something-else", seal("join-link", "a-token"))).toBeNull();
  });

  it("refuses a value whose ciphertext was edited", () => {
    const sealed = seal("join-link", "a-token");
    const [version, iv, body] = sealed.split(".");
    // Flip one character of the ciphertext. GCM authenticates it, so this is
    // the difference between "decrypts to garbage" and "does not decrypt".
    const edited = body.startsWith("A")
      ? `B${body.slice(1)}`
      : `A${body.slice(1)}`;

    expect(open("join-link", [version, iv, edited].join("."))).toBeNull();
  });

  it("refuses a value from an unknown version", () => {
    const sealed = seal("join-link", "a-token");
    expect(open("join-link", sealed.replace(/^v1\./, "v2."))).toBeNull();
  });

  it("refuses a truncated or missing value", () => {
    expect(open("join-link", null)).toBeNull();
    expect(open("join-link", "")).toBeNull();
    expect(open("join-link", "v1.")).toBeNull();
    expect(open("join-link", "not-sealed-at-all")).toBeNull();
  });

  it("returns nothing once the application secret has rotated", () => {
    const sealed = seal("join-link", "a-token");
    withSecret("rotated-secret-fedcba9876543210fedcba98765432");

    expect(open("join-link", sealed)).toBeNull();
  });
});
