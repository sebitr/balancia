import { describe, expect, it } from "vitest";
import { CODE_LENGTH, isWellFormedCode, normalizeCode } from "./code-format";
import { codeHash, codesMatch, generateCode } from "./codes";

/**
 * The properties a six-digit code has to keep, none of which are obvious from
 * reading the digits.
 *
 * The one that matters most is the pepper: the digest of a code must depend on
 * the account it was issued for, because every other safeguard around short
 * codes assumes a lookup by digits alone can never find a row.
 */

describe("generateCode", () => {
  it("is always six digits, leading zeros kept", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isWellFormedCode(code)).toBe(true);
    }
  });

  it("reaches both ends of the range rather than a comfortable middle", () => {
    // A modulo of random bytes would still pass the shape test above while
    // favouring low values, so this samples enough to see the spread.
    const codes = Array.from({ length: 500 }, () => Number(generateCode()));
    expect(Math.min(...codes)).toBeLessThan(200_000);
    expect(Math.max(...codes)).toBeGreaterThan(800_000);
  });
});

describe("codeHash", () => {
  it("is peppered with the account, so the same digits differ per user", () => {
    const one = codeHash("11111111-1111-4111-8111-111111111111", "123456");
    const two = codeHash("22222222-2222-4222-8222-222222222222", "123456");
    expect(one).not.toBe(two);
  });

  it("is stable for one account and code", () => {
    const user = "11111111-1111-4111-8111-111111111111";
    expect(codeHash(user, "000123")).toBe(codeHash(user, "000123"));
  });

  it("keeps leading zeros significant", () => {
    const user = "11111111-1111-4111-8111-111111111111";
    expect(codeHash(user, "000123")).not.toBe(codeHash(user, "123"));
  });
});

describe("normalizeCode", () => {
  it("drops everything that is not a digit", () => {
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("Your code is 123456.")).toBe("123456");
  });

  it("stops at six digits", () => {
    expect(normalizeCode("1234567890")).toBe("123456");
  });

  it("leaves a partial code partial rather than padding it", () => {
    expect(normalizeCode("12")).toBe("12");
    expect(isWellFormedCode(normalizeCode("12"))).toBe(false);
  });
});

describe("codesMatch", () => {
  it("accepts a digest against itself", () => {
    const hash = codeHash("11111111-1111-4111-8111-111111111111", "123456");
    expect(codesMatch(hash, hash)).toBe(true);
  });

  it("rejects a different digest, an empty one and a ragged one", () => {
    const user = "11111111-1111-4111-8111-111111111111";
    expect(codesMatch(codeHash(user, "123456"), codeHash(user, "123457"))).toBe(
      false,
    );
    expect(codesMatch("", "")).toBe(false);
    expect(codesMatch(codeHash(user, "123456"), "abcd")).toBe(false);
  });
});
