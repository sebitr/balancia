/**
 * Which password manager a passkey lives in, from the authenticator's AAGUID.
 *
 * The settings list used to be a column of identical shields, every row
 * labelled "Passkey", and the removal sheet asked people to confirm deleting
 * one of four things it could not tell apart. The AAGUID is the answer: a
 * model identifier every authenticator reports at registration, the same 16
 * bytes on every iPhone in the world, which is what makes it safe to store
 * and useless for identifying anybody.
 *
 * **Unknown is silent.** A name here is shown to a reader as a fact about
 * where their credential is kept, so a wrong one is worse than none: somebody
 * looking for their 1Password entry and told it is in iCloud Keychain will
 * delete the wrong row. Anything not in this table falls back to the generic
 * label, and that is the intended behaviour rather than a gap to be filled
 * with guesses.
 *
 * The list below is the subset of the community AAGUID register
 * (github.com/passkeydeveloper/passkey-authenticator-aaguids) that covers
 * what Balancia's readers actually use. Adding a row is a one-line change;
 * take the value from that register rather than from a search result, because
 * nothing downstream can tell a mistyped AAGUID from an unknown one — it will
 * simply never match, and the row will quietly stay generic forever.
 */

/**
 * All zeroes: the authenticator declining to say which model it is.
 *
 * Documented behaviour, not a fault, and several authenticators mean it —
 * a browser may also zero the field when attestation was not asked for. It is
 * stored as null so that "said nothing" and "said something we do not know"
 * are the same state to everything downstream.
 */
export const ANONYMOUS_AAGUID = "00000000-0000-0000-0000-000000000000";

const PROVIDERS: Readonly<Record<string, string>> = {
  // Apple
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  // Google
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome",
  // Microsoft
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  // Password managers
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6": "Keeper",
  "cd69adb5-3c7a-deb9-3177-6800ea6cb72a": "Proton Pass",
  "fdb141b2-5d84-443e-8a35-4698c205a502": "KeePassXC",
  "f3809540-7f14-49c1-a8b3-8f813b225541": "Enpass",
  // Security keys
  "cb69481e-8ff7-4039-93ec-0a2729a154a8": "YubiKey 5",
  "ee882879-721c-4913-9775-3dfcce97072a": "YubiKey 5",
  "d8522d9f-575b-4866-88a9-ba99fa02f35b": "YubiKey Bio",
};

/**
 * Normalises what an authenticator reported into what is worth storing.
 *
 * Returns null for the anonymous AAGUID and for anything malformed, so the
 * column holds either a usable identifier or nothing at all.
 */
export function storableAaguid(aaguid: string | undefined): string | null {
  if (!aaguid) return null;
  const normalised = aaguid.trim().toLowerCase();
  if (normalised === ANONYMOUS_AAGUID) return null;
  return /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(normalised)
    ? normalised
    : null;
}

/** The provider's name, or null when this AAGUID is not one we can name. */
export function passkeyProviderName(aaguid: string | null): string | null {
  if (!aaguid) return null;
  return PROVIDERS[aaguid.trim().toLowerCase()] ?? null;
}
