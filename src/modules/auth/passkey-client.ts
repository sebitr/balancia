"use client";

import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
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

/** Signs in with a discoverable passkey — no email needed. */
export async function signInWithPasskey(): Promise<void> {
  const optionsResponse = await fetch("/api/auth/passkey/authenticate");
  if (!optionsResponse.ok) {
    throw new Error(await readError(optionsResponse));
  }
  const options = await optionsResponse.json();

  const assertion = await startAuthentication({ optionsJSON: options });

  const verifyResponse = await fetch("/api/auth/passkey/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response: assertion }),
  });
  if (!verifyResponse.ok) {
    throw new Error(await readError(verifyResponse));
  }
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
