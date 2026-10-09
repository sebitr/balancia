import { describe, expect, it } from "vitest";
import { hashToken } from "@/lib/security/tokens";
import { sanitizeClientName } from "./client-name";
import {
  generateAccessToken,
  generateAuthorizationCode,
  generateRefreshToken,
  isWellFormedAccessToken,
  isWellFormedAuthorizationCode,
  isWellFormedRefreshToken,
} from "./tokens";

describe("the three secrets of the flow", () => {
  it("announce themselves, so a scanner can find one before it leaks", () => {
    expect(generateAccessToken().raw.startsWith("bla_")).toBe(true);
    expect(generateRefreshToken().raw.startsWith("blr_")).toBe(true);
  });

  it("store only a hash, and a prefix too short to be a secret", () => {
    const token = generateAccessToken();
    expect(token.hash).toBe(hashToken(token.raw));
    expect(token.hash).not.toContain(token.raw);
    expect(token.prefix).toHaveLength(12);
    expect(token.raw.startsWith(token.prefix)).toBe(true);
  });

  it("are never the same twice", () => {
    const seen = new Set(
      Array.from({ length: 200 }, () => generateAuthorizationCode().raw),
    );
    expect(seen.size).toBe(200);
  });

  it("pass their own shape check and fail each other's", () => {
    const access = generateAccessToken().raw;
    const refresh = generateRefreshToken().raw;
    const code = generateAuthorizationCode().raw;

    expect(isWellFormedAccessToken(access)).toBe(true);
    expect(isWellFormedRefreshToken(refresh)).toBe(true);
    expect(isWellFormedAuthorizationCode(code)).toBe(true);

    // A refresh token must not open /mcp, and an access token must not refresh.
    expect(isWellFormedAccessToken(refresh)).toBe(false);
    expect(isWellFormedRefreshToken(access)).toBe(false);
    // An API key is a different table's business.
    expect(isWellFormedAccessToken(`blc_${"A".repeat(43)}`)).toBe(false);
  });

  it("refuse anything near-miss before it costs a query", () => {
    for (const bad of [
      "",
      "bla_",
      `bla_${"A".repeat(42)}`,
      `bla_${"A".repeat(44)}`,
      `bla_${"A".repeat(42)}!`,
    ]) {
      expect(isWellFormedAccessToken(bad)).toBe(false);
    }
  });
});

/**
 * Spelled by code point rather than typed: an invisible character in the
 * source is exactly the trick this test is about, and an editor that expands
 * an escape would put one there.
 */
const RLO = String.fromCodePoint(0x202e); // right-to-left override
const ZWSP = String.fromCodePoint(0x200b); // zero-width space

describe("an application's name, as a person will read it", () => {
  it("passes an ordinary name through", () => {
    expect(sanitizeClientName("Claude")).toBe("Claude");
    expect(sanitizeClientName("Cursor (VS Code fork)")).toBe(
      "Cursor (VS Code fork)",
    );
  });

  it("takes out the characters that make text read backwards or vanish", () => {
    // U+202E is the right-to-left override; U+200B a zero-width space.
    expect(sanitizeClientName(`Balancia${RLO} Official`)).toBe(
      "Balancia Official",
    );
    expect(sanitizeClientName(`Bal${ZWSP}ancia`)).toBe("Bal ancia");
  });

  it("collapses padding, so a name cannot push the address off the screen", () => {
    expect(sanitizeClientName("Claude\n\n\n\n   \t  Desktop")).toBe(
      "Claude Desktop",
    );
  });

  it("caps the length", () => {
    expect(sanitizeClientName("x".repeat(500))).toHaveLength(100);
  });

  it("says so when it was not told a name", () => {
    for (const nothing of [undefined, null, 42, "", "   ", `${RLO}${ZWSP}`]) {
      expect(sanitizeClientName(nothing)).toBe("Unnamed application");
    }
  });
});
