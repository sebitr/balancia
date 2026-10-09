import { describe, expect, it } from "vitest";
import {
  challengeFor,
  isValidCodeChallenge,
  isValidCodeVerifier,
  verifyCodeChallenge,
} from "./pkce";

/** The worked example in RFC 7636 Appendix B. */
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("PKCE, S256", () => {
  it("derives the challenge the RFC gives", () => {
    expect(challengeFor(VERIFIER)).toBe(CHALLENGE);
  });

  it("accepts the verifier the challenge was made from", () => {
    expect(verifyCodeChallenge(VERIFIER, CHALLENGE)).toBe(true);
  });

  it("refuses any other verifier", () => {
    expect(verifyCodeChallenge(`${VERIFIER}x`, CHALLENGE)).toBe(false);
    expect(verifyCodeChallenge("A".repeat(43), CHALLENGE)).toBe(false);
  });

  it("refuses the challenge itself offered as the verifier", () => {
    // The `plain` method, which is not offered: if it were, this would pass.
    expect(verifyCodeChallenge(CHALLENGE, CHALLENGE)).toBe(false);
  });

  it("refuses a verifier that is not one before comparing anything", () => {
    for (const bad of [
      undefined,
      null,
      42,
      "",
      "short",
      `${VERIFIER}!`,
      " ".repeat(43),
    ]) {
      expect(verifyCodeChallenge(bad, CHALLENGE)).toBe(false);
    }
  });

  it("holds a verifier to the length the RFC sets", () => {
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(128))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
  });

  it("holds a challenge to the shape of a SHA-256", () => {
    expect(isValidCodeChallenge(CHALLENGE)).toBe(true);
    expect(isValidCodeChallenge(`${CHALLENGE}=`)).toBe(false);
    expect(isValidCodeChallenge(CHALLENGE.slice(1))).toBe(false);
    expect(isValidCodeChallenge(undefined)).toBe(false);
  });
});
