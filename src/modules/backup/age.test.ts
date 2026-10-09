import { describe, expect, it } from "vitest";
import {
  createRecoveryKey,
  decryptWith,
  encryptTo,
  keyFingerprint,
  parseRecipient,
  recipientOf,
} from "./age";

/**
 * The promise the feature makes is that the server cannot read a backup, so
 * what is tested is the shape of that promise: the recipient alone encrypts, only
 * its identity decrypts, and a key that is slightly wrong is refused at setup
 * rather than discovered on the night it is needed.
 */

const text = (value: string) => new TextEncoder().encode(value);

describe("a recovery key", () => {
  it("is an age identity whose recipient can be derived again from it", async () => {
    const { identity, recipient } = await createRecoveryKey();

    expect(identity).toMatch(/^AGE-SECRET-KEY-1[A-Z0-9]+$/);
    expect(recipient).toMatch(/^age1[a-z0-9]+$/);
    expect(await recipientOf(identity)).toBe(recipient);
  });

  it("is not mistaken for something else when pasted back", async () => {
    expect(await recipientOf("age1notanidentity")).toBeNull();
    expect(await recipientOf("AGE-SECRET-KEY-1TOOSHORT")).toBeNull();
    expect(await recipientOf("")).toBeNull();
  });
});

describe("encryptTo and decryptWith", () => {
  it("round-trips a document through the public half alone", async () => {
    const { identity, recipient } = await createRecoveryKey();

    const sealed = await encryptTo(recipient, text('{"hello":"world"}'));

    expect(new TextDecoder().decode(sealed)).not.toContain("hello");
    expect(new TextDecoder().decode(await decryptWith(identity, sealed))).toBe(
      '{"hello":"world"}',
    );
  });

  it("writes the age format, so the age command can open it too", async () => {
    const { recipient } = await createRecoveryKey();

    const sealed = await encryptTo(recipient, text("x"));

    expect(new TextDecoder().decode(sealed.slice(0, 22))).toBe(
      "age-encryption.org/v1\n",
    );
  });

  it("never produces the same file twice", async () => {
    const { recipient } = await createRecoveryKey();

    const first = await encryptTo(recipient, text("same"));
    const second = await encryptTo(recipient, text("same"));

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
  });

  it("refuses a different recovery key", async () => {
    const owner = await createRecoveryKey();
    const stranger = await createRecoveryKey();

    const sealed = await encryptTo(owner.recipient, text("private"));

    await expect(decryptWith(stranger.identity, sealed)).rejects.toThrow();
  });

  it("refuses a file that was changed in transit", async () => {
    const { identity, recipient } = await createRecoveryKey();
    const sealed = await encryptTo(recipient, text("private ".repeat(100)));

    const tampered = sealed.slice();
    tampered[tampered.length - 20] ^= 0xff;

    await expect(decryptWith(identity, tampered)).rejects.toThrow();
  });

  it("copes with a document larger than one age chunk", async () => {
    const { identity, recipient } = await createRecoveryKey();
    const big = new Uint8Array(300_000).map((_, index) => index % 251);

    const opened = await decryptWith(identity, await encryptTo(recipient, big));

    expect(Buffer.from(opened).equals(Buffer.from(big))).toBe(true);
  });
});

describe("parseRecipient", () => {
  it("accepts a real recipient, with stray whitespace removed", async () => {
    const { recipient } = await createRecoveryKey();

    expect(await parseRecipient(`  ${recipient}\n`)).toBe(recipient);
  });

  it("refuses a recipient with one character changed", async () => {
    const { recipient } = await createRecoveryKey();
    const last = recipient.at(-1) === "q" ? "p" : "q";

    expect(await parseRecipient(recipient.slice(0, -1) + last)).toBeNull();
  });

  it("refuses the private half, which must never be stored", async () => {
    const { identity } = await createRecoveryKey();

    expect(await parseRecipient(identity)).toBeNull();
  });

  it("refuses things that are not recipients at all", async () => {
    expect(await parseRecipient("")).toBeNull();
    expect(await parseRecipient("hello")).toBeNull();
    expect(await parseRecipient("ssh-ed25519 AAAAC3Nz")).toBeNull();
    expect(await parseRecipient("age1tag1qqqq")).toBeNull();
  });
});

describe("keyFingerprint", () => {
  it("names a key in eight hex digits, the same way every time", async () => {
    const { recipient } = await createRecoveryKey();

    const fingerprint = await keyFingerprint(recipient);

    expect(fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(await keyFingerprint(recipient)).toBe(fingerprint);
  });

  it("tells two keys apart", async () => {
    const first = await createRecoveryKey();
    const second = await createRecoveryKey();

    expect(await keyFingerprint(first.recipient)).not.toBe(
      await keyFingerprint(second.recipient),
    );
  });
});
