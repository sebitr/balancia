import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_AAGUID,
  passkeyProviderName,
  storableAaguid,
} from "./passkey-providers";

/**
 * The rule these guard is that a wrong name is worse than no name.
 *
 * A row in the settings list captioned "iCloud Keychain" is a claim about
 * where somebody's credential is kept, and they act on it — it is how they
 * decide which of four passkeys the removal sheet is about. So everything
 * uncertain has to come out as null and fall back to the generic label.
 */

describe("storableAaguid", () => {
  it("keeps an authenticator that named itself", () => {
    expect(storableAaguid("fbfc3007-154e-4ecc-8c0b-6e020557d7bd")).toBe(
      "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
    );
  });

  it("lowercases, so one authenticator is one key", () => {
    expect(storableAaguid("FBFC3007-154E-4ECC-8C0B-6E020557D7BD")).toBe(
      "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
    );
  });

  it("drops the all-zero AAGUID", () => {
    // Documented behaviour rather than a fault: plenty of authenticators
    // decline to say which model they are, and a browser zeroes the field when
    // attestation was not asked for. Stored as nothing, so that "said nothing"
    // and "said something unrecognised" are one state downstream.
    expect(storableAaguid(ANONYMOUS_AAGUID)).toBeNull();
  });

  it.each([
    { reason: "empty", value: "" },
    { reason: "absent", value: undefined },
    { reason: "prose", value: "not-an-aaguid" },
    { reason: "undashed", value: "fbfc3007154e4ecc8c0b6e020557d7bd" },
    { reason: "over-long", value: "fbfc3007-154e-4ecc-8c0b-6e020557d7bdd" },
    { reason: "not hex", value: "zzzzzzzz-154e-4ecc-8c0b-6e020557d7bd" },
  ])("drops an AAGUID that is $reason", ({ value }) => {
    expect(storableAaguid(value)).toBeNull();
  });
});

describe("passkeyProviderName", () => {
  it("names a provider it knows", () => {
    expect(passkeyProviderName("fbfc3007-154e-4ecc-8c0b-6e020557d7bd")).toBe(
      "iCloud Keychain",
    );
  });

  it("says nothing about one it does not", () => {
    // The important half. An unrecognised AAGUID is common — the register
    // grows faster than this table — and the row falls back to its generic
    // label rather than inventing a provider.
    expect(passkeyProviderName("11111111-2222-3333-4444-555555555555")).toBe(
      null,
    );
  });

  it("says nothing when there is no AAGUID at all", () => {
    expect(passkeyProviderName(null)).toBeNull();
  });
});
