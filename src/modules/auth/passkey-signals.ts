"use client";

/**
 * Telling a password manager what this account's passkeys actually are.
 *
 * Removing a passkey here used to change nothing on the reader's side. The
 * credential stayed in iCloud Keychain or 1Password for good, was still
 * offered at every sign-in, and choosing it produced "That passkey is not
 * registered here" — a dead entry the reader had no way to clear, because the
 * only party allowed to clear it is the site that issued it.
 *
 * The Signal API is how a site says so. It is spoken directly to
 * `PublicKeyCredential` rather than through @simplewebauthn, which does not
 * wrap these three calls, and it is absent in most browsers — so every one of
 * them is feature-detected, and every one of them is best-effort. A password
 * manager declining to listen is not a reason for a sign-in to fail, so
 * nothing here throws and nothing here is awaited for its answer.
 *
 * The reconcile call is the dangerous one and is treated as such: see
 * `reconcilePasskeyList`.
 */

/** One handle and the credentials filed under it. Mirrors the server's shape. */
export interface PasskeySignalGroup {
  readonly userHandle: string;
  readonly credentialIds: string[];
}

export interface PasskeySignalState {
  readonly name: string;
  readonly displayName: string;
  readonly groups: PasskeySignalGroup[];
}

/**
 * The three calls, as the browser exposes them.
 *
 * Hand-declared because they are newer than the DOM lib in this toolchain, and
 * narrow on purpose: a wrong shape here is a silent no-op in a browser that
 * does support them, which is the hardest kind of bug to notice.
 */
interface CredentialSignals {
  signalAllAcceptedCredentials?: (options: {
    rpId: string;
    userId: string;
    allAcceptedCredentialIds: string[];
  }) => Promise<void>;
  signalUnknownCredential?: (options: {
    rpId: string;
    credentialId: string;
  }) => Promise<void>;
  signalCurrentUserDetails?: (options: {
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
  }) => Promise<void>;
}

function signals(): CredentialSignals | null {
  if (typeof window === "undefined") return null;
  if (typeof window.PublicKeyCredential === "undefined") return null;
  return window.PublicKeyCredential as unknown as CredentialSignals;
}

/**
 * base64url, which is what every field of these calls is specified in.
 *
 * The handles the server mints are already base64url text, but they are text:
 * the authenticator was handed the *bytes of that string*, so this is the same
 * `TextEncoder` round trip the server does in reverse, not a re-encoding.
 */
function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Brings a password manager's list in line with what the account really holds.
 *
 * **This call deletes.** Anything stored under one of these handles that the
 * matching list leaves out is removed from the reader's password manager, and
 * a passkey is not recoverable. That is the whole point when a credential has
 * genuinely gone, and a catastrophe if the list is short by one — so the
 * server refuses to describe an account it cannot describe completely, and
 * hands back no groups at all rather than a partial picture. An empty
 * `groups` therefore means "say nothing", not "the reader has none".
 */
export function reconcilePasskeyList(
  rpId: string,
  state: PasskeySignalState,
): void {
  const api = signals();
  if (!api?.signalAllAcceptedCredentials) return;

  for (const group of state.groups) {
    void api
      .signalAllAcceptedCredentials({
        rpId,
        userId: toBase64Url(group.userHandle),
        allAcceptedCredentialIds: group.credentialIds,
      })
      .catch(() => {
        // Best effort. The list stays as it was, which is where it started.
      });
  }
}

/**
 * Tells the password manager that a credential it just offered is not ours.
 *
 * The one call that needs no handle, because it names a credential outright —
 * which makes it the only thing that can help an account whose handles are
 * still unknown, and the reason a failed sign-in is worth acting on rather
 * than only reporting.
 */
export function forgetUnknownPasskey(rpId: string, credentialId: string): void {
  const api = signals();
  if (!api?.signalUnknownCredential) return;
  void api.signalUnknownCredential({ rpId, credentialId }).catch(() => {});
}

/**
 * Updates the address and name shown against this account's passkeys.
 *
 * Without it, somebody who changes their address goes on being offered a
 * passkey labelled with the old one for the life of the credential — the
 * password manager has no other way to hear about it.
 */
export function updatePasskeyUserDetails(
  rpId: string,
  state: PasskeySignalState,
): void {
  const api = signals();
  if (!api?.signalCurrentUserDetails) return;

  for (const group of state.groups) {
    void api
      .signalCurrentUserDetails({
        rpId,
        userId: toBase64Url(group.userHandle),
        name: state.name,
        displayName: state.displayName,
      })
      .catch(() => {});
  }
}
