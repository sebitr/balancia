"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The browser's half of the signup proof of work.
 *
 * The server names a hash and a ceiling; the only way to the number behind it
 * is to try them, which is the point. See `lib/security/proof-of-work.ts` for
 * why this exists at all and what it is worth.
 *
 * Two things matter about *when* this runs. It starts on mount rather than on
 * submit, so the hashing happens while somebody is typing their name and the
 * button is never the thing that waits. And a solved challenge is spent by the
 * signup that carries it, so a second attempt — an address already taken, a
 * password the policy refused — needs a fresh one: `solution()` starts the
 * replacement the moment it hands the current answer out.
 */

export interface SolvedProofOfWork {
  readonly nonce: string;
  readonly number: number;
}

interface IssuedChallenge {
  readonly enabled: boolean;
  readonly nonce?: string;
  readonly challenge?: string;
  readonly maxNumber?: number;
}

/**
 * SHA-256 over a short ASCII string, hex encoded.
 *
 * `crypto.subtle` where there is one, and a hand-rolled fallback where there is
 * not — an instance served over plain HTTP on a local network has no Web
 * Crypto at all, and "your reverse proxy has no certificate" is not a reason
 * for the register form to stop working. The fallback is perhaps five times
 * slower, which on this workload is the difference between one second and five.
 */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256HexFallback(input);

  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (const byte of view) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** FIPS 180-4 round constants: the first 32 bits of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256HexFallback(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  // One 0x80 byte, then zeros, then a 64-bit big-endian length.
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, bitLength, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const view = new DataView(padded.buffer);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1)
      w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 =
        ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = [
      h[0]!,
      h[1]!,
      h[2]!,
      h[3]!,
      h[4]!,
      h[5]!,
      h[6]!,
      h[7]!,
    ];

    for (let i = 0; i < 64; i += 1) {
      const s1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  let hex = "";
  for (const word of h) hex += word.toString(16).padStart(8, "0");
  return hex;
}

/**
 * Hashes in batches rather than one await at a time.
 *
 * `crypto.subtle.digest` is asynchronous, and awaiting a hundred thousand of
 * them in sequence spends most of its time in the microtask queue rather than
 * in the hash. A batch of five hundred amortises that away, and gives the
 * browser a breath between batches so the form it is sitting behind still
 * scrolls.
 */
const BATCH = 500;

export async function solveProofOfWork(
  nonce: string,
  target: string,
  maxNumber: number,
): Promise<number | null> {
  for (let start = 0; start <= maxNumber; start += BATCH) {
    const size = Math.min(BATCH, maxNumber - start + 1);
    const digests = await Promise.all(
      Array.from({ length: size }, (_, index) =>
        sha256Hex(`${nonce}${start + index}`),
      ),
    );
    const hit = digests.indexOf(target);
    if (hit !== -1) return start + hit;
  }
  return null;
}

/**
 * What one round of this is worth: an answer, or a reason there is none.
 *
 * `disabled` is the difference between "this instance does not want a proof"
 * and "something went wrong getting one". The first is permanent for the life
 * of the page and stops the hook asking again; the second is not.
 */
type Attempt =
  | { readonly kind: "solved"; readonly solution: SolvedProofOfWork }
  | { readonly kind: "disabled" }
  | { readonly kind: "unavailable" };

async function fetchAndSolve(): Promise<Attempt> {
  let issued: IssuedChallenge;
  try {
    const response = await fetch("/api/auth/challenge", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { kind: "unavailable" };
    issued = (await response.json()) as IssuedChallenge;
  } catch {
    // Offline, or the endpoint is not there. Sending nothing is right either
    // way: an instance that wants a proof refuses the signup and says so, in
    // words the person can act on, and one that does not never noticed.
    return { kind: "unavailable" };
  }

  if (!issued.enabled) return { kind: "disabled" };
  if (!issued.nonce || !issued.challenge) return { kind: "unavailable" };

  const number = await solveProofOfWork(
    issued.nonce,
    issued.challenge,
    issued.maxNumber ?? 0,
  );
  return number === null
    ? { kind: "unavailable" }
    : { kind: "solved", solution: { nonce: issued.nonce, number } };
}

/**
 * Starts solving on mount and hands the answer over on demand.
 *
 * `solution()` is what a submit handler calls. It waits for whatever is in
 * flight — usually nothing left to wait for, because it finished while the
 * form was being filled in — and then starts the next one, because the answer
 * it has just given away is spent the moment the server sees it.
 *
 * Nothing is cancelled on unmount. The work is a bounded second of hashing and
 * letting it finish costs nobody anything, where cancelling it would need a
 * generation token to survive React's double-mount in development — which is
 * more machinery than the problem deserves.
 */
export function useProofOfWork(): {
  solution: () => Promise<SolvedProofOfWork | null>;
} {
  const pending = useRef<Promise<Attempt> | null>(null);
  const wanted = useRef(true);

  const start = useCallback(() => {
    if (!wanted.current) return;
    pending.current ??= fetchAndSolve();
  }, []);

  useEffect(start, [start]);

  const solution = useCallback(async () => {
    if (!wanted.current) return null;

    const attempt = await (pending.current ??= fetchAndSolve());
    pending.current = null;

    if (attempt.kind === "disabled") {
      // Settled for the life of this page: stop asking, and stop hashing.
      wanted.current = false;
      return null;
    }
    if (attempt.kind === "unavailable") return null;

    // Start the replacement before handing this one over, so a signup refused
    // for some other reason — the address is taken, the password too common —
    // has a fresh answer waiting rather than a spent one.
    pending.current = fetchAndSolve();
    return attempt.solution;
  }, []);

  return { solution };
}
