import { describe, expect, it } from "vitest";
import {
  createDecipheriv,
  createECDH,
  createHmac,
  randomBytes,
} from "node:crypto";
import { encryptPayload, MAX_PAYLOAD_BYTES } from "./encrypt";
import { PushKeyError, toBase64Url } from "./keys";

/**
 * The receiver half of RFC 8291, written from the specification rather than
 * from `encrypt.ts`.
 *
 * This is what makes the round-trip test worth having. Every input is taken
 * from the source a real receiver would use — its own public key derived from
 * its private key, the sender's public key read out of the message header — so
 * the two sides only agree on a key if the sender ordered and labelled the
 * derivation the way the RFC says. Swapping the two public keys in `key_info`,
 * or mislabelling an info string, fails the authentication tag here even
 * though both sides run the same HKDF helper.
 */
function decrypt(
  body: Buffer,
  receiverPrivateKey: Buffer,
  authSecret: Buffer,
): Buffer {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const keyIdLength = body.readUInt8(20);
  const senderPublicKey = body.subarray(21, 21 + keyIdLength);
  const ciphertext = body.subarray(21 + keyIdLength);

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(receiverPrivateKey);
  const receiverPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(senderPublicKey);

  const expand = (prk: Buffer, info: string, length: number): Buffer =>
    createHmac("sha256", prk)
      .update(Buffer.from(`${info}\0`, "ascii"))
      .update(Buffer.of(0x01))
      .digest()
      .subarray(0, length);

  const prkKey = createHmac("sha256", authSecret).update(sharedSecret).digest();
  const ikm = createHmac("sha256", prkKey)
    .update(Buffer.from("WebPush: info\0", "ascii"))
    .update(receiverPublicKey)
    .update(senderPublicKey)
    .update(Buffer.of(0x01))
    .digest();
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const cek = expand(prk, "Content-Encoding: aes128gcm", 16);
  const nonce = expand(prk, "Content-Encoding: nonce", 12);

  expect(recordSize).toBe(4096);
  expect(keyIdLength).toBe(65);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const sealed = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const padded = Buffer.concat([decipher.update(sealed), decipher.final()]);

  // The final record ends with the 0x02 delimiter.
  expect(padded.at(-1)).toBe(0x02);
  return padded.subarray(0, padded.length - 1);
}

function newSubscription() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    privateKey: ecdh.getPrivateKey(),
    authSecret,
    keys: {
      p256dh: toBase64Url(ecdh.getPublicKey()),
      auth: toBase64Url(authSecret),
    },
  };
}

describe("encryptPayload", () => {
  it("produces a body the subscription's own key can decrypt", () => {
    const subscription = newSubscription();
    const message = "When I grow up, I want to be a watermelon";

    const body = encryptPayload(message, subscription.keys);

    expect(
      decrypt(body, subscription.privateKey, subscription.authSecret).toString(
        "utf8",
      ),
    ).toBe(message);
  });

  it("round-trips UTF-8 beyond the ASCII range", () => {
    const subscription = newSubscription();
    const message = JSON.stringify({
      title: "Café — 12,50 €",
      body: "Amélie a ajouté une dépense",
    });

    const body = encryptPayload(message, subscription.keys);

    expect(
      decrypt(body, subscription.privateKey, subscription.authSecret).toString(
        "utf8",
      ),
    ).toBe(message);
  });

  it("cannot be decrypted with a different subscription's key", () => {
    const subscription = newSubscription();
    const other = newSubscription();

    const body = encryptPayload("secret", subscription.keys);

    expect(() => decrypt(body, other.privateKey, other.authSecret)).toThrow();
  });

  it("writes the RFC 8188 header: salt, record size, then the sender's key", () => {
    const subscription = newSubscription();

    const body = encryptPayload("hello", subscription.keys);

    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    // The key id is an uncompressed EC point, and it is the sender's, not the
    // receiver's.
    const senderKey = body.subarray(21, 86);
    expect(senderKey[0]).toBe(0x04);
    expect(
      senderKey.equals(Buffer.from(subscription.keys.p256dh, "base64url")),
    ).toBe(false);
  });

  it("uses a fresh ephemeral key and salt for every message", () => {
    const subscription = newSubscription();

    const first = encryptPayload("same text", subscription.keys);
    const second = encryptPayload("same text", subscription.keys);

    // Salt (0..16) and sender key (21..86) must both differ; reusing either
    // would reuse an AES-GCM key and nonce together.
    expect(first.subarray(0, 16).equals(second.subarray(0, 16))).toBe(false);
    expect(first.subarray(21, 86).equals(second.subarray(21, 86))).toBe(false);
  });

  it("is byte-for-byte reproducible when the ephemeral inputs are supplied", () => {
    const subscription = newSubscription();
    const sender = createECDH("prime256v1");
    sender.generateKeys();
    const ephemeral = {
      asPrivate: sender.getPrivateKey(),
      salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"),
    };

    const first = encryptPayload("hello", subscription.keys, ephemeral);
    const second = encryptPayload("hello", subscription.keys, ephemeral);

    expect(first.equals(second)).toBe(true);
    expect(first.subarray(0, 16).equals(ephemeral.salt)).toBe(true);
    expect(
      decrypt(first, subscription.privateKey, subscription.authSecret).toString(
        "utf8",
      ),
    ).toBe("hello");
  });

  it("rejects a subscription key that is not a point on the curve", () => {
    const subscription = newSubscription();
    expect(() =>
      encryptPayload("hello", {
        p256dh: toBase64Url(Buffer.alloc(65, 4)),
        auth: subscription.keys.auth,
      }),
    ).toThrow(PushKeyError);
  });

  it("rejects standard base64 that is not base64url", () => {
    const subscription = newSubscription();
    expect(() =>
      encryptPayload("hello", {
        p256dh: "BCVxsr7N/eNgVRqvHtD0zTZsEc6+VV==",
        auth: subscription.keys.auth,
      }),
    ).toThrow(/base64url/);
  });

  it("rejects an auth secret of the wrong length", () => {
    const subscription = newSubscription();
    expect(() =>
      encryptPayload("hello", {
        ...subscription.keys,
        auth: toBase64Url(Buffer.alloc(8)),
      }),
    ).toThrow(/16 bytes/);
  });

  it("refuses a payload too large for one record", () => {
    const subscription = newSubscription();
    expect(() =>
      encryptPayload("x".repeat(MAX_PAYLOAD_BYTES + 1), subscription.keys),
    ).toThrow(/limit is/);
  });
});
