import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { seal } from "@/lib/security/secret-box";
import {
  REGISTRATION_COOKIE_TTL_SECONDS,
  encodeRegistration,
  registeredHere,
} from "./registration-browser";

/**
 * The cookie that lets a confirmation link sign in the browser that asked
 * for it, and only that browser.
 *
 * Everything it is worth is in what it refuses: another account's value, a
 * value past its day, a value somebody wrote themselves. The route that reads
 * it is tested against a real database in `verify-email.test.ts`.
 */

const ADA = "0b6d8c52-3f2e-4a8e-9a3c-4f5b2d1e7c90";
const GRACE = "7f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
  process.env.DATABASE_URL = "postgres://balancia:pw@localhost:5432/balancia";
  process.env.APP_URL = "https://balancia.example.com";
  resetEnvCache();
});

describe("registeredHere", () => {
  it("recognises the account this browser registered", () => {
    expect(registeredHere(encodeRegistration(ADA), ADA)).toBe(true);
  });

  it("says nothing for another account", () => {
    expect(registeredHere(encodeRegistration(GRACE), ADA)).toBe(false);
  });

  it("stops counting when the link it vouches for would have", () => {
    const issued = new Date("2026-09-01T08:00:00Z");
    const value = encodeRegistration(ADA, issued);
    const justBefore = new Date(
      issued.getTime() + REGISTRATION_COOKIE_TTL_SECONDS * 1000 - 1,
    );
    const after = new Date(
      issued.getTime() + REGISTRATION_COOKIE_TTL_SECONDS * 1000,
    );

    expect(registeredHere(value, ADA, justBefore)).toBe(true);
    expect(registeredHere(value, ADA, after)).toBe(false);
  });

  it("refuses a value nobody sealed for this purpose", () => {
    // What somebody who can write a cookie for this host could plant: the
    // payload is right, and it opens under no key this module uses.
    const planted = seal(
      "join-link",
      JSON.stringify({ userId: ADA, expiresAt: Date.now() + 60_000 }),
    );

    expect(registeredHere(planted, ADA)).toBe(false);
    expect(registeredHere(`{"userId":"${ADA}"}`, ADA)).toBe(false);
    expect(registeredHere(undefined, ADA)).toBe(false);
  });
});
