"use client";

import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
} from "@simplewebauthn/browser";

/**
 * What this browser can actually do with passkeys.
 *
 * There used to be three separate probes for this, each asked from somewhere
 * else and each answering one question: can it do WebAuthn at all, does it
 * have an authenticator of its own, will it put a passkey in an autofill
 * dropdown. `getClientCapabilities` answers all of those and several more in
 * one call, and it is the only way to ask the fourth question — whether the
 * browser can create a passkey silently — which has no probe of its own.
 *
 * It is also newer than most of the browsers that will run this, so the old
 * probes remain as the fallback rather than as dead code. A browser without
 * `getClientCapabilities` gets the same answers it always did, except for the
 * silent upgrade, which it is simply told it cannot do.
 */

export interface PasskeyCapabilities {
  /** WebAuthn exists here at all. */
  readonly supported: boolean;
  /** This device can hold a passkey itself — a face, a finger, a screen lock. */
  readonly platformAuthenticator: boolean;
  /** A passkey can be offered from a field's own autofill dropdown. */
  readonly conditionalGet: boolean;
  /** A passkey can be created without putting a sheet in front of anybody. */
  readonly conditionalCreate: boolean;
}

const NONE: PasskeyCapabilities = {
  supported: false,
  platformAuthenticator: false,
  conditionalGet: false,
  conditionalCreate: false,
};

/** The shape of the call, which is newer than this toolchain's DOM lib. */
interface CapabilityReader {
  getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
}

/**
 * Asked once and remembered.
 *
 * The answer is a fact about the browser, not about the page, and three
 * separate screens want it. Caching the *promise* rather than the value means
 * two of them mounting together make one call rather than two.
 */
let cached: Promise<PasskeyCapabilities> | null = null;

export function readPasskeyCapabilities(): Promise<PasskeyCapabilities> {
  cached ??= probe();
  return cached;
}

async function probe(): Promise<PasskeyCapabilities> {
  if (typeof window === "undefined" || !browserSupportsWebAuthn()) return NONE;

  const reader = window.PublicKeyCredential as unknown as CapabilityReader;
  if (typeof reader.getClientCapabilities === "function") {
    try {
      const capabilities = await reader.getClientCapabilities();
      return {
        supported: true,
        /*
         * Two spellings of nearly the same question, and both are worth
         * taking: `passkeyPlatformAuthenticator` means one that can hold a
         * *discoverable* credential — which is the only kind this app can sign
         * in with — while the older flag only promises user verification.
         */
        platformAuthenticator:
          capabilities.passkeyPlatformAuthenticator ??
          capabilities.userVerifyingPlatformAuthenticator ??
          false,
        conditionalGet: capabilities.conditionalGet ?? false,
        conditionalCreate: capabilities.conditionalCreate ?? false,
      };
    } catch {
      // Fall through to the probes below rather than reporting nothing: a
      // browser that has the call and throws on it can still do WebAuthn.
    }
  }

  const [platformAuthenticator, conditionalGet] = await Promise.all([
    platformAuthenticatorIsAvailable().catch(() => false),
    browserSupportsWebAuthnAutofill().catch(() => false),
  ]);

  return {
    supported: true,
    platformAuthenticator,
    conditionalGet,
    // No probe exists for this one, and guessing at it would mean starting a
    // ceremony to find out. A browser this old is told no.
    conditionalCreate: false,
  };
}

/** Forgets the cached answer. For tests, which run many browsers in one process. */
export function resetPasskeyCapabilities(): void {
  cached = null;
}
