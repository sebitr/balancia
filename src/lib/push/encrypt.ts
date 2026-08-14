import {
  createCipheriv,
  createECDH,
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  AUTH_SECRET_BYTES,
  decodeFixed,
  decodePublicKey,
  PushKeyError,
} from "./keys";

/**
 * Message Encryption for Web Push — RFC 8291, over the `aes128gcm` content
 * coding of RFC 8188.
 *
 * The push service is an untrusted relay: it sees the endpoint and the size
 * and timing of every message, but never the contents. That is the whole
 * reason this exists, and the reason Balancia never puts an amount or a name
 * into a payload it did not encrypt itself.
 *
 * Key derivation, in the order the RFC specifies it:
 *
 *   ecdh_secret = ECDH(as_private, ua_public)
 *   PRK_key     = HMAC-SHA-256(auth_secret, ecdh_secret)
 *   key_info    = "WebPush: info" ‖ 0x00 ‖ ua_public ‖ as_public
 *   IKM         = HMAC-SHA-256(PRK_key, key_info ‖ 0x01)
 *   PRK         = HMAC-SHA-256(salt, IKM)
 *   CEK         = HMAC-SHA-256(PRK, "Content-Encoding: aes128gcm" ‖ 0x00 ‖ 0x01)[0..16]
 *   NONCE       = HMAC-SHA-256(PRK, "Content-Encoding: nonce" ‖ 0x00 ‖ 0x01)[0..12]
 *
 * The body is then the RFC 8188 header (salt, record size, sender key)
 * followed by one AES-128-GCM record.
 */

/** Record size. One record is always enough: payloads here are a few hundred bytes. */
const RECORD_SIZE = 4096;

/**
 * Largest plaintext that fits one record, leaving room for the 0x02 delimiter
 * and the 16-byte GCM tag. Push services also cap a message at 4096 octets of
 * *body*, so anything approaching this would be rejected anyway.
 */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 17;

export interface SubscriptionKeys {
  /** The subscription's public key, base64url (`keys.p256dh`). */
  readonly p256dh: string;
  /** The subscription's auth secret, base64url (`keys.auth`). */
  readonly auth: string;
}

/**
 * Ephemeral inputs. Supplied only by the tests, so the RFC's published example
 * can be reproduced byte for byte; a real message always gets fresh randomness,
 * because reusing either value across two messages to the same subscription
 * would reuse an AES-GCM key and nonce together and lose confidentiality.
 */
export interface EphemeralInputs {
  readonly asPrivate: Buffer;
  readonly salt: Buffer;
}

/** HKDF-Expand with a single-block output, which is all RFC 8291 ever needs. */
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  return createHmac("sha256", prk)
    .update(info)
    .update(Buffer.of(0x01))
    .digest()
    .subarray(0, length);
}

function contextInfo(label: string): Buffer {
  return Buffer.concat([Buffer.from(label, "ascii"), Buffer.of(0x00)]);
}

/**
 * Encrypts one push payload for one subscription.
 *
 * `ephemeral` exists for the RFC test vectors only — leave it out.
 */
export function encryptPayload(
  payload: string | Buffer,
  subscription: SubscriptionKeys,
  ephemeral?: EphemeralInputs,
): Buffer {
  const plaintext = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload, "utf8");
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new PushKeyError(
      `Push payload is ${plaintext.length} bytes; the limit is ${MAX_PAYLOAD_BYTES}.`,
    );
  }

  const uaPublic = decodePublicKey(subscription.p256dh, "Subscription p256dh");
  const authSecret = decodeFixed(
    subscription.auth,
    AUTH_SECRET_BYTES,
    "Subscription auth secret",
  );

  const ecdh = createECDH("prime256v1");
  if (ephemeral) {
    ecdh.setPrivateKey(ephemeral.asPrivate);
  } else {
    ecdh.generateKeys();
  }
  const asPublic = ecdh.getPublicKey();
  const salt = ephemeral?.salt ?? randomBytes(16);

  let sharedSecret: Buffer;
  try {
    sharedSecret = ecdh.computeSecret(uaPublic);
  } catch {
    // A point that is not on the curve — a corrupted or hostile subscription.
    throw new PushKeyError(
      "Subscription p256dh is not a valid P-256 public key.",
    );
  }

  const prkKey = createHmac("sha256", authSecret).update(sharedSecret).digest();
  const keyInfo = Buffer.concat([
    contextInfo("WebPush: info"),
    uaPublic,
    asPublic,
  ]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  const prk = createHmac("sha256", salt).update(ikm).digest();
  const contentEncryptionKey = hkdfExpand(
    prk,
    contextInfo("Content-Encoding: aes128gcm"),
    16,
  );
  const nonce = hkdfExpand(prk, contextInfo("Content-Encoding: nonce"), 12);

  const cipher = createCipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    // 0x02 marks the last record; RFC 8188 §2 pads with this delimiter byte.
    cipher.update(Buffer.of(0x02)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  // The "key id" of an aes128gcm push message is the sender's public key.
  header.writeUInt8(asPublic.length, 20);

  return Buffer.concat([header, asPublic, ciphertext]);
}
