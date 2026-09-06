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
    // Apple's current name for it. The table said "iCloud Keychain" while it
    // was written from memory, which is the mild half of what that cost —
    // see the file's own comment for the other half.
    expect(passkeyProviderName("fbfc3007-154e-4ecc-8c0b-6e020557d7bd")).toBe(
      "Apple Passwords",
    );
  });

  it("does not attribute the Thales SDK's identifier to Proton Pass", () => {
    /*
     * The one mistake worth a test of its own, because it is the shape of
     * error this whole file is arranged against: not a value that fails to
     * match, but a real identifier confidently pointed at the wrong provider.
     * Somebody looking for their Proton Pass credential would have been shown
     * one, and deleted the wrong row.
     */
    expect(passkeyProviderName("cd69adb5-3c7a-deb9-3177-6800ea6cb72a")).toBe(
      "Thales PIN Android SDK",
    );
    expect(passkeyProviderName("50726f74-6f6e-5061-7373-50726f746f6e")).toBe(
      "Proton Pass",
    );
  });

  it("says nothing about a hardware security key", () => {
    // Not a gap. The register this table comes from covers passkey providers,
    // not authenticator models, so a YubiKey takes the generic label rather
    // than one guessed from memory — which is how the mistake above happened.
    expect(passkeyProviderName("cb69481e-8ff7-4039-93ec-0a2729a154a8")).toBe(
      null,
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
