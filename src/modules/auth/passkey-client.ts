"use client";

import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { readPasskeyCapabilities } from "./passkey-capabilities";
import {
  forgetUnknownPasskey,
  reconcilePasskeyList,
  updatePasskeyUserDetails,
  type PasskeySignalState,
} from "./passkey-signals";

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
  return (await readPasskeyCapabilities()).platformAuthenticator;
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
  return (await readPasskeyCapabilities()).conditionalGet;
}

/**
 * Whether a passkey can be created here without a sheet in front of anybody.
 *
 * The newest of the four, and the one with no fallback probe: a browser that
 * cannot answer `getClientCapabilities` is told no rather than made to find
 * out by starting a ceremony it might not be able to finish quietly.
 */
export async function supportsPasskeyUpgrade(): Promise<boolean> {
  return (await readPasskeyCapabilities()).conditionalCreate;
}

/**
 * The server's sentence, already in the reader's language.
 *
 * Empty when there is none — a proxy answering instead of the route, a body
 * that is not JSON. There is no `useTranslations` to reach from here, so the
 * screen that catches the error supplies the fallback: `error.message || t(…)`.
 */
async function readError(response: Response): Promise<string> {
  return (await readRefusal(response)).message;
}

/**
 * The same, plus the reason code — which is the part that can be acted on.
 *
 * The sentence is for the reader and has already been translated, so it cannot
 * be compared against anything. `code` is the stable name of the refusal, and
 * `passkeyUnknown` in particular is worth catching: it is the server saying
 * the credential the browser just offered is not registered here.
 */
async function readRefusal(
  response: Response,
): Promise<{ message: string; code: string | null }> {
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    return { message: body.error ?? "", code: body.code ?? null };
  } catch {
    return { message: "", code: null };
  }
}

/** What a route hands back so the browser can go and tidy up afterwards. */
interface SignalPayload {
  rpId?: string;
  signal?: PasskeySignalState | null;
}

async function readSignal(response: Response): Promise<SignalPayload> {
  try {
    return (await response.json()) as SignalPayload;
  } catch {
    return {};
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
 * Quietly gives a password sign-in a passkey to go with it.
 *
 * Conditional creation: the browser puts no sheet on screen and asks for no
 * gesture, because the reader has just proved themselves with a password from
 * the very password manager being asked to store this. It is the one thing
 * that moves passkey adoption without a screen asking somebody to consider
 * their authentication strategy on the way to splitting a dinner bill.
 *
 * Silent, including when it fails, and it fails often by design: an account
 * that already has a passkey from this manager is refused by
 * `excludeCredentials` — an `InvalidStateError` meaning "they have one", which
 * is a success as far as this is concerned. That is what makes it safe to call
 * on every password sign-in without keeping a note of whether it worked.
 *
 * It asks `/upgrade` rather than `/register`, and the difference is consent.
 * That route answers 204 for an account that has removed a passkey: somebody
 * who has been to the settings screen to take one off has said what they think
 * of having one, and minting another moments after their next password would
 * be the app overruling them — invisibly, so the only way to notice would be
 * to go back to the screen where they said no. The button on that screen still
 * works, because pressing it is a fresh decision.
 *
 * Nothing is said afterwards, and that is deliberate rather than an omission.
 * A toast would announce a credential the reader did not ask to create, over a
 * page that is already navigating away; the password manager itself is what
 * tells them a passkey was saved, in its own words, where they can act on it —
 * and the settings list is where it can be found and removed later, which is
 * the part that has to be true rather than the part that has to be loud.
 */
export async function upgradeToPasskey(): Promise<void> {
  try {
    if (!(await supportsPasskeyUpgrade())) return;

    const optionsResponse = await fetch("/api/auth/passkey/upgrade");
    // 204: this account has said no already. Anything else unreadable is a
    // non-event for a ceremony nobody asked for.
    if (!optionsResponse.ok || optionsResponse.status === 204) return;
    const options = await optionsResponse.json();

    const attestation = await startRegistration({
      optionsJSON: options,
      useAutoRegister: true,
    });

    await fetch("/api/auth/passkey/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: attestation }),
    });
  } catch {
    // Every failure here is one the reader should not hear about: they asked
    // to sign in, and they did.
  }
}

/**
 * Tells the reader's password manager what this account now holds.
 *
 * Shared by every path that changes the answer, and silent when the server
 * declined to describe the account — which it does whenever any credential's
 * handle is still unknown, because a partial list is a destructive one.
 */
function applySignals(payload: SignalPayload): void {
  if (!payload.rpId || !payload.signal) return;
  reconcilePasskeyList(payload.rpId, payload.signal);
  updatePasskeyUserDetails(payload.rpId, payload.signal);
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
 *
 * Answers true when a session was started. False is the armed request
 * declining to arm — the options handout refused, which a reader flicking
 * between tabs can reach on the rate limiter alone. The button says so out
 * loud instead, because somebody is waiting on it.
 */
async function authenticate(useBrowserAutofill: boolean): Promise<boolean> {
  const optionsResponse = await fetch("/api/auth/passkey/authenticate");
  if (!optionsResponse.ok) {
    if (useBrowserAutofill) return false;
    throw new Error(await readError(optionsResponse));
  }
  const options =
    (await optionsResponse.json()) as PublicKeyCredentialRequestOptionsJSON;

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
    const refusal = await readRefusal(verifyResponse);
    /*
     * The credential the reader just picked is not one this account has. Left
     * alone, their password manager goes on offering it at every sign-in and
     * fails the same way every time, with nothing they can press to stop it —
     * so this is the moment to ask for it to be forgotten. `rpId` comes from
     * the options the server just issued, which is the authority on it.
     */
    if (refusal.code === "passkeyUnknown" && options.rpId) {
      forgetUnknownPasskey(options.rpId, assertion.id);
    }
    throw new Error(refusal.message);
  }

  applySignals(await readSignal(verifyResponse));
  return true;
}

/** Signs in with a discoverable passkey — no email needed. */
export async function signInWithPasskey(): Promise<void> {
  await authenticate(false);
}

/**
 * Offers the account's passkey in the email field's own autofill dropdown.
 *
 * Resolves true once the session cookie is set, which can only happen if the
 * reader chose the passkey and the server accepted the assertion. Until then
 * it simply stays pending, for as long as the page is open: this is not a
 * request anybody is waiting on, and how it fails is usually not news anybody
 * asked for.
 *
 * False means it never armed at all, so there is nothing in the dropdown and
 * nothing to report — the caller must not read it as an arrival.
 */
export async function armPasskeyAutofill(): Promise<boolean> {
  return authenticate(true);
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
  /** The authenticator's model, which names the provider it lives in. */
  readonly aaguid: string | null;
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

  // Deleting the row is half the job: until this runs, the credential is still
  // in the reader's password manager and still offered at every sign-in.
  applySignals(await readSignal(response));
}

/**
 * Re-captions this account's passkeys after its name or address changed.
 *
 * Fetches rather than being told, because the screens that change those things
 * are Server Actions with nothing passkey-shaped in their answer. Best effort
 * throughout: a password manager that does not listen leaves the old caption,
 * which is what was there anyway.
 */
export async function refreshPasskeyUserDetails(): Promise<void> {
  try {
    const response = await fetch("/api/auth/passkey/signal");
    if (!response.ok) return;
    applySignals(await readSignal(response));
  } catch {
    // Offline, or the route is gone. Neither is worth a word to the reader.
  }
}
