import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Authenticated encryption for the few secrets a screen has to show again.
 *
 * Almost everything in `tokens.ts` is stored as a hash and never recovered:
 * that is the right shape for a credential the server only ever has to
 * recognise. The group join link is the exception, because the whole point of
 * it is that the organiser can open group settings a week later and send it to
 * one more person — a link that cannot be shown again is a link that has to be
 * replaced to be shared, which invalidates it for everyone who already has it.
 *
 * So that one token is kept in a form the server can read back, and this is
 * the form: AES-256-GCM under a key derived from `AUTH_SECRET`, which is not
 * in the database. A dump of the tables alone still yields no working links —
 * the property the token rules are there to protect — and it takes the
 * application secret as well to undo it.
 *
 * The key is derived per purpose rather than used directly, so a ciphertext
 * sealed for one use cannot be opened by another, and rotating `AUTH_SECRET`
 * makes every sealed value unreadable rather than wrong: `open` returns null,
 * and callers treat that as "we no longer have this" rather than as an error.
 */

/** Bumped if the construction ever changes; old versions then fail to open. */
const VERSION = "v1";

const KEY_BYTES = 32;
/** 96 bits, the size GCM is specified for. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFor(purpose: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      getEnv().AUTH_SECRET,
      "",
      `balancia:${purpose}`,
      KEY_BYTES,
    ),
  );
}

/** Seals a value for one named purpose. The result is safe to store. */
export function seal(purpose: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose), iv);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  // Version, nonce and ciphertext-with-tag, in one field so a row carries
  // everything needed to open it except the key.
  return [
    VERSION,
    iv.toString("base64url"),
    Buffer.concat([body, cipher.getAuthTag()]).toString("base64url"),
  ].join(".");
}

/**
 * Opens a value sealed for the same purpose.
 *
 * Null for anything that does not open — the wrong purpose, a rotated secret,
 * a truncated column, a tampered row. The caller cannot act on the difference
 * and the screens say the same thing for all of them.
 */
export function open(purpose: string, sealed: string | null): string | null {
  if (!sealed) return null;
  const [version, rawIv, rawBody] = sealed.split(".");
  if (version !== VERSION || !rawIv || !rawBody) return null;

  try {
    const iv = Buffer.from(rawIv, "base64url");
    const bytes = Buffer.from(rawBody, "base64url");
    if (iv.length !== IV_BYTES || bytes.length <= TAG_BYTES) return null;

    const decipher = createDecipheriv("aes-256-gcm", keyFor(purpose), iv);
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(bytes.subarray(0, bytes.length - TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
