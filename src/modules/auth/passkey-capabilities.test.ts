// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readPasskeyCapabilities,
  resetPasskeyCapabilities,
} from "./passkey-capabilities";

/**
 * One question instead of three, and an answer for the fourth.
 *
 * `getClientCapabilities` is newer than most browsers that will run this, so
 * the older probes are the fallback rather than dead code — and the fallback
 * has to keep giving the same answers it always did, because two screens lay
 * their buttons out from them.
 */

/**
 * A `PublicKeyCredential` that satisfies SimpleWebAuthn's support check.
 *
 * It insists on a *function*, not an object: a plain stub reads as "this
 * browser has no WebAuthn" and every capability comes back false, which is a
 * quietly passing test that proves nothing.
 */
function stubCredential(statics: Record<string, unknown>): void {
  const stub = function PublicKeyCredential() {};
  Object.assign(stub, statics);
  vi.stubGlobal("PublicKeyCredential", stub);
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetPasskeyCapabilities();
});

describe("readPasskeyCapabilities", () => {
  it("reports nothing where WebAuthn does not exist", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);

    expect(await readPasskeyCapabilities()).toEqual({
      supported: false,
      platformAuthenticator: false,
      conditionalGet: false,
      conditionalCreate: false,
    });
  });

  it("takes every answer from one call where the browser has it", async () => {
    stubCredential({
      getClientCapabilities: () =>
        Promise.resolve({
          conditionalCreate: true,
          conditionalGet: true,
          passkeyPlatformAuthenticator: true,
          userVerifyingPlatformAuthenticator: true,
        }),
    });

    expect(await readPasskeyCapabilities()).toEqual({
      supported: true,
      platformAuthenticator: true,
      conditionalGet: true,
      conditionalCreate: true,
    });
  });

  it("prefers the passkey-shaped question to the older one", async () => {
    // A machine with Windows Hello but no passkey support answers yes to
    // "can verify a user" and no to "can hold a discoverable credential". The
    // second is the one that matters: sign-in sends no `allowCredentials`, so
    // a credential the authenticator cannot find on its own is no use here.
    stubCredential({
      getClientCapabilities: () =>
        Promise.resolve({
          passkeyPlatformAuthenticator: false,
          userVerifyingPlatformAuthenticator: true,
        }),
    });

    expect((await readPasskeyCapabilities()).platformAuthenticator).toBe(false);
  });

  it("treats an unreported capability as absent", async () => {
    stubCredential({ getClientCapabilities: () => Promise.resolve({}) });

    expect(await readPasskeyCapabilities()).toEqual({
      supported: true,
      platformAuthenticator: false,
      conditionalGet: false,
      conditionalCreate: false,
    });
  });

  it("falls back to the old probes where the call is missing", async () => {
    stubCredential({
      isUserVerifyingPlatformAuthenticatorAvailable: () =>
        Promise.resolve(true),
      isConditionalMediationAvailable: () => Promise.resolve(true),
    });

    expect(await readPasskeyCapabilities()).toEqual({
      supported: true,
      platformAuthenticator: true,
      conditionalGet: true,
      // No probe exists for this one, and finding out means starting a
      // ceremony that might not stay quiet. A browser this old is told no.
      conditionalCreate: false,
    });
  });

  it("falls back rather than reporting nothing when the call throws", async () => {
    stubCredential({
      getClientCapabilities: () => Promise.reject(new Error("nope")),
      isUserVerifyingPlatformAuthenticatorAvailable: () =>
        Promise.resolve(true),
      isConditionalMediationAvailable: () => Promise.resolve(false),
    });

    expect(await readPasskeyCapabilities()).toEqual({
      supported: true,
      platformAuthenticator: true,
      conditionalGet: false,
      conditionalCreate: false,
    });
  });

  it("asks the browser once, however many screens want the answer", async () => {
    const getClientCapabilities = vi.fn(() =>
      Promise.resolve({ conditionalGet: true }),
    );
    stubCredential({ getClientCapabilities });

    await Promise.all([
      readPasskeyCapabilities(),
      readPasskeyCapabilities(),
      readPasskeyCapabilities(),
    ]);

    expect(getClientCapabilities).toHaveBeenCalledOnce();
  });
});
