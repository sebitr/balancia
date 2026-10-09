/**
 * The one place Balancia touches the `age` format.
 *
 * Kept free of `server-only` on purpose: the browser makes the recovery key
 * and, years later, opens a backup with it, while the worker only ever
 * encrypts to the public half. Both halves import this file, so the two sides
 * of the format cannot drift.
 *
 * ## Why age, and why the recipient is all the server ever sees
 *
 * A backup that a scheduled job writes at three in the morning cannot ask
 * anyone for a passphrase. So the key is a pair: the *recipient* (`age1…`,
 * public) lives in the database and lets the worker encrypt; the *identity*
 * (`AGE-SECRET-KEY-1…`, private) is made in the owner's browser, shown once,
 * and never sent anywhere. Whoever holds the server and the cloud account
 * still cannot read a single backup, which is the whole claim of the feature.
 *
 * `age` rather than something of our own because the format is small,
 * specified and audited, and because it has a second implementation: a file
 * written here opens with Filippo Valsorda's `age` command, so the day
 * Balancia is gone the backups are still readable.
 *
 *     age --decrypt --identity recovery-key.txt backup.json.gz.age | gunzip
 *
 * ## Loaded when used, not when imported
 *
 * The library is imported on first use. On Node 24 it probes Web Crypto for
 * algorithms it may or may not find, and Node prints an `ExperimentalWarning`
 * for the probe — twice, at the start of every process that merely *imports*
 * it, which here would be every web process and every worker, whether or not a
 * backup ever ran. The cost of waiting is one dynamic import, once.
 */

type Age = typeof import("age-encryption");

let loaded: Promise<Age> | undefined;
const age = (): Promise<Age> => (loaded ??= import("age-encryption"));

/** Recipient prefixes this feature will encrypt to: X25519 and post-quantum hybrid. */
const ACCEPTED_RECIPIENTS = ["age1pq1", "age1"] as const;

/**
 * A recipient string this feature accepts, normalised — or null.
 *
 * Parsed by the library (`addRecipient` decodes the Bech32 and checks its
 * checksum), not matched by a pattern, so a mistyped character is refused
 * here rather than at three in the morning when the first backup fails.
 * Hardware-token recipients (`age1tag1…`, `age1tagpq1…`) are valid age but
 * need a plugin on the machine that decrypts, which the restore screen does
 * not have, so they are not offered.
 */
export async function parseRecipient(value: string): Promise<string | null> {
  const recipient = value.trim();
  if (!ACCEPTED_RECIPIENTS.some((prefix) => recipient.startsWith(prefix))) {
    return null;
  }
  if (recipient.startsWith("age1tag")) return null;
  try {
    new (await age()).Encrypter().addRecipient(recipient);
  } catch {
    return null;
  }
  return recipient;
}

/** Encrypts `plaintext` so that only the holder of `recipient`'s identity can read it. */
export async function encryptTo(
  recipient: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const encrypter = new (await age()).Encrypter();
  encrypter.addRecipient(recipient);
  return encrypter.encrypt(plaintext);
}

/** Opens a file written by {@link encryptTo}. Throws if the identity is not the right one. */
export async function decryptWith(
  identity: string,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const decrypter = new (await age()).Decrypter();
  decrypter.addIdentity(identity.trim());
  return decrypter.decrypt(ciphertext);
}

/** A fresh recovery key and the recipient that goes with it. Browser use. */
export async function createRecoveryKey(): Promise<{
  readonly identity: string;
  readonly recipient: string;
}> {
  const { generateIdentity, identityToRecipient } = await age();
  const identity = await generateIdentity();
  return { identity, recipient: await identityToRecipient(identity) };
}

/** The recipient that goes with a pasted recovery key, or null if it is not one. */
export async function recipientOf(identity: string): Promise<string | null> {
  const value = identity.trim();
  if (!value.toUpperCase().startsWith("AGE-SECRET-KEY-")) return null;
  try {
    return await (await age()).identityToRecipient(value);
  } catch {
    return null;
  }
}

/**
 * Eight hex digits that name a recipient, for telling two keys apart on a
 * screen ("Key 9f3a1c2e") without printing anything secret. A label, not a
 * check: it is derived from the public half, which anybody holding the
 * database can read anyway.
 */
export async function keyFingerprint(recipient: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(recipient),
  );
  return Array.from(new Uint8Array(digest).slice(0, 4), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
