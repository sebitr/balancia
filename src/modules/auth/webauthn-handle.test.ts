import { describe, expect, it } from "vitest";
import { decodeUserHandle } from "./webauthn";

/**
 * Reading the user handle back out of an assertion.
 *
 * This is the only place a handle can be learned rather than issued, which
 * makes it the only place a *wrong* one can get in — and wrong is much worse
 * than missing here. Missing keeps the account in the state where
 * `passkeySignalState` refuses to describe it at all. Wrong makes the account
 * look completely known while filing one credential under a name no
 * authenticator holds, and `signalAllAcceptedCredentials` would then be handed
 * a list for the real handle with that credential's sibling left out — which
 * is an instruction to delete a working passkey.
 *
 * Neither decoding step fails loudly: base64url decoding accepts nearly
 * anything and UTF-8 decoding substitutes replacement characters rather than
 * throwing. So the shape check is what stands between a garbled byte and a
 * deleted credential.
 */

/** What the browser sends: base64url of the bytes the authenticator stored. */
const asAssertion = (handle: string): string =>
  Buffer.from(new TextEncoder().encode(handle)).toString("base64url");

describe("decodeUserHandle", () => {
  it("round-trips a handle the server minted", () => {
    const handle = "kZ8vQe2mR7tYuI0pAsDfGhJkL1xCvBnM3qWeRtYuI0p";

    expect(decodeUserHandle(asAssertion(handle))).toBe(handle);
  });

  it("round-trips the account id, which older credentials carry", () => {
    const handle = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

    expect(decodeUserHandle(asAssertion(handle))).toBe(handle);
  });

  it("says nothing when the authenticator sent no handle", () => {
    expect(decodeUserHandle(undefined)).toBeNull();
    expect(decodeUserHandle("")).toBeNull();
  });

  it("refuses bytes that are not a handle we could have issued", () => {
    // Raw binary an authenticator might return if the credential had been
    // created by something other than this app. It decodes without complaint
    // into replacement characters, so only the shape check catches it.
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x01]).toString("base64url");

    expect(decodeUserHandle(binary)).toBeNull();
  });

  it("refuses a handle carrying anything outside base64url", () => {
    // Every handle Balancia has issued is base64url text or a UUID. Anything
    // else did not come from here, so it is not something to file a credential
    // under and then reconcile against.
    expect(decodeUserHandle(asAssertion("has spaces"))).toBeNull();
    expect(decodeUserHandle(asAssertion("has/slash"))).toBeNull();
    expect(decodeUserHandle(asAssertion("héllo"))).toBeNull();
  });

  it("refuses an implausibly long handle", () => {
    expect(decodeUserHandle(asAssertion("a".repeat(257)))).toBeNull();
  });
});
