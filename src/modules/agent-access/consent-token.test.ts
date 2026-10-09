import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
  }),
}));

const { openConsent, sealConsent } = await import("./consent-token");

/**
 * The seal on the consent form. It is what stops a page that edits hidden
 * fields from changing where a code is sent after the person has read where it
 * was going, so the cases are the edits somebody would make.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

const claims = {
  u: USER,
  c: CLIENT,
  r: "https://claude.ai/api/mcp/auth_callback",
  h: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  s: "state-123",
  m: "write" as const,
};

const NOW = new Date("2026-10-08T12:00:00Z");

describe("the consent seal", () => {
  it("opens to exactly what was sealed", () => {
    const sealed = sealConsent(claims, NOW);
    expect(openConsent(sealed, NOW)).toMatchObject(claims);
  });

  it("is good for ten minutes and not a second longer", () => {
    const sealed = sealConsent(claims, NOW);
    expect(
      openConsent(sealed, new Date(NOW.getTime() + 599_000)),
    ).not.toBeNull();
    expect(openConsent(sealed, new Date(NOW.getTime() + 600_000))).toBeNull();
  });

  it("refuses a payload that has been edited", () => {
    const sealed = sealConsent(claims, NOW);
    const [payload, signature] = sealed.split(".") as [string, string];
    const edited = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString()),
        r: "https://evil.example/steal",
      }),
    ).toString("base64url");

    expect(openConsent(`${edited}.${signature}`, NOW)).toBeNull();
  });

  it("refuses a signature that has been edited", () => {
    const sealed = sealConsent(claims, NOW);
    const forged = `${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`;
    expect(openConsent(forged, NOW)).toBeNull();
  });

  it("refuses what is not a seal at all", () => {
    for (const nothing of [undefined, null, 42, "", ".", "abc", "a.b", {}]) {
      expect(openConsent(nothing, NOW)).toBeNull();
    }
  });

  it("does not open a seal made for something else", () => {
    // The same payload signed without this feature's domain separation.
    const payload = Buffer.from(
      JSON.stringify({ ...claims, x: 9_999_999_999 }),
    ).toString("base64url");
    expect(openConsent(`${payload}.${"A".repeat(43)}`, NOW)).toBeNull();
  });
});
