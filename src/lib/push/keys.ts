import {
  createECDH,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "node:crypto";

/**
 * Raw P-256 key material, and the ASN.1 needed to hand it to `node:crypto`.
 *
 * VAPID keys travel as raw base64url values — a 32-byte private scalar and a
 * 65-byte uncompressed public point — because that is what the Web Push
 * ecosystem and `PushManager.subscribe()` expect. Node's signing API wants a
 * `KeyObject`, which it will only build from DER. Both DER encodings for
 * P-256 are fixed-shape, so the conversion is a constant prefix plus the raw
 * bytes rather than a general ASN.1 encoder.
 */

/** Uncompressed EC point: 0x04 || X(32) || Y(32). */
export const PUBLIC_KEY_BYTES = 65;
/** P-256 private scalar. */
export const PRIVATE_KEY_BYTES = 32;
/** The auth secret a subscription carries (RFC 8291 §3). */
export const AUTH_SECRET_BYTES = 16;

export class PushKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushKeyError";
  }
}

/**
 * Decodes base64url without accepting base64. The distinction matters: a key
 * pasted from a tool that emits standard base64 would decode to the right
 * length here and then fail much later, inside a push service's 400.
 */
export function fromBase64Url(value: string, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PushKeyError(
      `${label} must be base64url (A–Z, a–z, 0–9, "-", "_", no padding).`,
    );
  }
  return Buffer.from(value, "base64url");
}

export function toBase64Url(value: Buffer | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

/** Decodes and length-checks one of the fixed-size values above. */
export function decodeFixed(
  value: string,
  expectedBytes: number,
  label: string,
): Buffer {
  const decoded = fromBase64Url(value, label);
  if (decoded.length !== expectedBytes) {
    throw new PushKeyError(
      `${label} must decode to ${expectedBytes} bytes, got ${decoded.length}.`,
    );
  }
  return decoded;
}

/** Decodes a public key and rejects the compressed and hybrid point forms. */
export function decodePublicKey(value: string, label: string): Buffer {
  const decoded = decodeFixed(value, PUBLIC_KEY_BYTES, label);
  if (decoded[0] !== 0x04) {
    throw new PushKeyError(
      `${label} must be an uncompressed EC point (65 bytes starting with 0x04).`,
    );
  }
  return decoded;
}

/**
 * SEC1 `ECPrivateKey` (RFC 5915) for P-256, everything except the 32-byte
 * scalar and the 65-byte point:
 *
 *   SEQUENCE {
 *     INTEGER 1                                  30 77 02 01 01
 *     OCTET STRING (32)   -- the private scalar  04 20 ‹scalar›
 *     [0] { OID prime256v1 }                     a0 0a 06 08 2a8648ce3d030107
 *     [1] { BIT STRING (65) -- the point }       a1 44 03 42 00 ‹point›
 *   }
 */
const SEC1_HEAD = Buffer.from("30770201010420", "hex");
const SEC1_PARAMS = Buffer.from("a00a06082a8648ce3d030107a144034200", "hex");

/**
 * SPKI `SubjectPublicKeyInfo` for P-256, everything before the 65-byte point:
 *
 *   SEQUENCE {
 *     SEQUENCE { OID ecPublicKey, OID prime256v1 }
 *     BIT STRING (65) -- the point
 *   }
 */
const SPKI_HEAD = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex",
);

/**
 * Generates a P-256 key pair as the raw base64url values Web Push uses.
 *
 * The scalar is left-padded to a fixed 32 bytes. Node returns the minimal
 * big-endian encoding, which is one byte short whenever the scalar happens to
 * start with a zero — about one key in 256. Such a key is perfectly valid and
 * would be rejected by every length check downstream, so the padding is what
 * stops a rare generated key from being mysteriously unusable.
 */
export function generateKeyPair(): {
  publicKey: string;
  privateKey: string;
} {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const scalar = ecdh.getPrivateKey();
  const padded = Buffer.alloc(PRIVATE_KEY_BYTES);
  scalar.copy(padded, PRIVATE_KEY_BYTES - scalar.length);
  return {
    publicKey: toBase64Url(ecdh.getPublicKey()),
    privateKey: toBase64Url(padded),
  };
}

/** Derives the uncompressed public point for a raw private scalar. */
export function publicKeyFromPrivate(privateKey: Buffer): Buffer {
  const ecdh = createECDH("prime256v1");
  try {
    ecdh.setPrivateKey(privateKey);
  } catch {
    throw new PushKeyError(
      "The push private key is not a valid P-256 scalar. Regenerate the key pair with `pnpm push:keys`.",
    );
  }
  return ecdh.getPublicKey();
}

/**
 * Builds a signing key from the raw pair.
 *
 * The public point is a required part of the SEC1 structure, so it is derived
 * rather than trusted — which also means a mismatched pair cannot be assembled
 * into a key that signs with one half and advertises the other.
 */
export function privateKeyObject(privateKey: Buffer): KeyObject {
  const point = publicKeyFromPrivate(privateKey);
  const der = Buffer.concat([SEC1_HEAD, privateKey, SEC1_PARAMS, point]);
  return createPrivateKey({ key: der, format: "der", type: "sec1" });
}

/** Builds a verification key from a raw uncompressed point. */
export function publicKeyObject(publicKey: Buffer): KeyObject {
  const der = Buffer.concat([SPKI_HEAD, publicKey]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}
