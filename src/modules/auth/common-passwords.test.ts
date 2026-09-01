import { describe, expect, it } from "vitest";
import {
  containsIdentity,
  isCommonPassword,
  normalizePassword,
} from "./common-passwords";
import { assertPasswordPolicy, PasswordError } from "./passwords";

/**
 * The point of these is the *decoration*, not the list.
 *
 * A blocklist of a few hundred words is only worth having because
 * `normalizePassword` sees through what people put around them to satisfy a
 * length or a symbol requirement. If that stops working the list refuses
 * `password` and nothing else, which is the same as refusing nothing.
 */

describe("normalizePassword", () => {
  it("strips the year, the capital and the punctuation", () => {
    expect(normalizePassword("Password123!")).toBe("password");
    expect(normalizePassword("password")).toBe("password");
    expect(normalizePassword("  PASSWORD  ")).toBe("password");
  });

  it("undoes the leetspeak everybody uses", () => {
    expect(normalizePassword("p@ssw0rd")).toBe("password");
    expect(normalizePassword("l3tm31n")).toBe("letmein");
  });

  it("comes back empty for something with no letters in it", () => {
    expect(normalizePassword("1234567890")).toBe("");
  });
});

describe("isCommonPassword", () => {
  it("refuses the openings of every stuffing list, however dressed up", () => {
    for (const password of [
      "password",
      "Password1",
      "password123",
      "p@ssw0rd2026",
      "qwertyuiop",
      "iloveyou2026",
      "Sunshine!!!",
      "letmein12345",
    ]) {
      expect(isCommonPassword(password), password).toBe(true);
    }
  });

  it("refuses a run and a single repeated character", () => {
    expect(isCommonPassword("aaaaaaaaaa")).toBe(true);
    expect(isCommonPassword("abababababab")).toBe(true);
    expect(isCommonPassword("1234567890")).toBe(true);
    expect(isCommonPassword("0987654321")).toBe(true);
  });

  it("refuses a short common word repeated up to length", () => {
    expect(isCommonPassword("lovelovelove")).toBe(false); // "love" is not listed
    expect(isCommonPassword("summersummer")).toBe(true);
  });

  it("allows something nobody is guessing", () => {
    for (const password of [
      "quiet-lantern-drifts-42",
      "Th3-Marmalade-Ferry",
      "gravel-oboe-tuesday",
      "kZ9!vqx-Lm2p",
    ]) {
      expect(isCommonPassword(password), password).toBe(false);
    }
  });
});

describe("containsIdentity", () => {
  const identity = { email: "ada.lovelace@example.test", name: "Ada Lovelace" };

  it("catches the surname and the address, decoration and all", () => {
    expect(containsIdentity("Lovelace-2026!", identity)).toBe(true);
    expect(containsIdentity("my-ada.lovelace-pw", identity)).toBe(true);
  });

  it("ignores a fragment too short to mean anything", () => {
    // "Ada" is three letters: refusing every password containing it would
    // refuse "adamant", "nomad" and most of the dictionary.
    expect(containsIdentity("adamant-ferry-oboe", { name: "Ada" })).toBe(false);
  });

  it("says nothing about an account it was told nothing about", () => {
    expect(containsIdentity("quiet-lantern-drifts-42", {})).toBe(false);
  });
});

describe("assertPasswordPolicy", () => {
  it("still enforces the length bounds it always did", () => {
    expect(() => assertPasswordPolicy("short")).toThrow(PasswordError);
    expect(() => assertPasswordPolicy("x".repeat(513))).toThrow(PasswordError);
  });

  it("names its reason, so the form can be answered in French", () => {
    const thrown = (password: string, identity = {}) => {
      try {
        assertPasswordPolicy(password, identity);
      } catch (error) {
        return error as PasswordError;
      }
      return null;
    };

    expect(thrown("short")?.code).toBe("passwordTooShort");
    expect(thrown("x".repeat(513))?.code).toBe("passwordTooLong");
    expect(thrown("Password123!")?.code).toBe("passwordCommon");
    expect(thrown("Lovelace-ferry-oboe", { name: "Ada Lovelace" })?.code).toBe(
      "passwordPersonal",
    );
  });

  it("accepts a passphrase that clears all three", () => {
    expect(() =>
      assertPasswordPolicy("gravel-oboe-tuesday", {
        email: "ada@example.test",
        name: "Ada Lovelace",
      }),
    ).not.toThrow();
  });
});
