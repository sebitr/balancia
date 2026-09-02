"use client";

import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";

/**
 * Browser side of the passkey ceremonies.
 *
 * Thin wrapper: it fetches server-issued options, hands them to the browser's
 * WebAuthn API, and posts the authenticator's response back. No verification
 * happens here — the client is not trusted to decide whether a passkey is
 * valid.
 */

export function supportsPasskeys(): boolean {
  return browserSupportsWebAuthn();
}

/**
 * Whether this device can hold a passkey of its own.
 *
 * `supportsPasskeys` is true on every desktop Chrome and Firefox, including a
 * machine with no Touch ID, no Windows Hello and no security key — where a
 * "Continue with a passkey" button opens a sheet asking for a phone or a key
 * the reader may not have. This asks about the platform authenticator, which
 * is what "your face, fingerprint or screen lock" means, and it is what
 * decides whether the passkey is the first offer or the second.
 */
export async function supportsPlatformPasskeys(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/**
 * Whether this browser can offer a passkey from a field's autofill dropdown.
 *
 * A different question from `supportsPasskeys`, and worth asking separately:
 * conditional mediation arrived years after WebAuthn itself, so a browser can
 * do the modal ceremony and not this one. The answer is a promise because the
 * browser resolves it against the platform authenticator rather than a table.
 */
export async function supportsPasskeyAutofill(): Promise<boolean> {
  return browserSupportsWebAuthnAutofill();
}

/**
 * The server's sentence, already in the reader's language.
 *
 * Empty when there is none — a proxy answering instead of the route, a body
 * that is not JSON. There is no `useTranslations` to reach from here, so the
 * screen that catches the error supplies the fallback: `error.message || t(…)`.
 */
async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? "";
  } catch {
    return "";
  }
}

/** Registers a new passkey on the signed-in account. */
export async function registerPasskey(name?: string): Promise<void> {
  const optionsResponse = await fetch("/api/auth/passkey/register");
  if (!optionsResponse.ok) {
    throw new Error(await readError(optionsResponse));
  }
  const options = await optionsResponse.json();

  // Throws if the user cancels or the authenticator refuses.
  const attestation = await startRegistration({ optionsJSON: options });

  const verifyResponse = await fetch("/api/auth/passkey/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response: attestation, name }),
  });
  if (!verifyResponse.ok) {
    throw new Error(await readError(verifyResponse));
  }
}

/**
 * The sign-in ceremony, in the two mediations it is offered under.
 *
 * `useBrowserAutofill` is the only difference, and it is a client-side flag:
 * both ask the server for the same discoverable-credential options, and the
 * server is never told which one asked. What changes is when the browser
 * settles. Modal mediation puts a sheet on the screen straight away.
 * Conditional mediation puts the passkey in the autofill dropdown of the
 * field marked `autocomplete="… webauthn"` and resolves nothing until the
 * reader picks it out.
 */
async function authenticate(useBrowserAutofill: boolean): Promise<void> {
  const optionsResponse = await fetch("/api/auth/passkey/authenticate");
  if (!optionsResponse.ok) {
    throw new Error(await readError(optionsResponse));
  }
  const options = await optionsResponse.json();

  const assertion = await startAuthentication({
    optionsJSON: options,
    useBrowserAutofill,
  });

  const verifyResponse = await fetch("/api/auth/passkey/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response: assertion }),
  });
  if (!verifyResponse.ok) {
    throw new Error(await readError(verifyResponse));
  }
}

/** Signs in with a discoverable passkey — no email needed. */
export async function signInWithPasskey(): Promise<void> {
  await authenticate(false);
}

/**
 * Offers the account's passkey in the email field's own autofill dropdown.
 *
 * Resolves once the session cookie is set, which can only happen if the reader
 * chose the passkey and the server accepted the assertion — so a caller may
 * read resolution as "signed in". Until then it simply stays pending, for as
 * long as the page is open: this is not a request anybody is waiting on, and
 * how it fails is usually not news anybody asked for.
 */
export async function armPasskeyAutofill(): Promise<void> {
  await authenticate(true);
}

/**
 * Cancels whichever ceremony is open, conditional or modal.
 *
 * There is one, because `startAuthentication` arms a singleton — which is also
 * why pressing the passkey button cancels a pending autofill request rather
 * than colliding with it. A screen that armed one calls this as it unmounts,
 * so the pending promise rejects with an `AbortError` instead of resolving
 * into a navigation on a page that is gone.
 */
export function cancelPasskeyCeremony(): void {
  WebAuthnAbortService.cancelCeremony();
}

export interface PasskeyRecord {
  readonly id: string;
  readonly name: string | null;
  readonly deviceType: string | null;
  readonly backedUp: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export async function fetchPasskeys(): Promise<PasskeyRecord[]> {
  const response = await fetch("/api/auth/passkey");
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = (await response.json()) as { passkeys: PasskeyRecord[] };
  return body.passkeys;
}

export async function removePasskey(id: string): Promise<void> {
  const response = await fetch("/api/auth/passkey", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}
