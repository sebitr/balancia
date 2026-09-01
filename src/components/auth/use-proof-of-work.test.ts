import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  sha256Hex,
  sha256HexFallback,
  solveProofOfWork,
} from "./use-proof-of-work";

/**
 * A hand-rolled SHA-256 is exactly the kind of code that is wrong in one case
 * and right in every other, and the one case is a length nobody tried. It only
 * runs where `crypto.subtle` is missing — an instance served over plain HTTP —
 * which is also where nobody would notice it was wrong until sign-ups stopped
 * working there and only there.
 *
 * So Node's own implementation is the oracle, across every message length that
 * changes the padding, and the two ends of the protocol are checked against
 * each other rather than against a transcription of what each is supposed to
 * do.
 */

const reference = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

describe("sha256HexFallback", () => {
  it("agrees with the published vectors", () => {
    expect(sha256HexFallback("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256HexFallback("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("agrees with Node across every padding boundary", () => {
    // 55 and 56 are where a message stops fitting in one block with its length
    // suffix, and 63–65 are the block boundary itself. A padding bug lives in
    // exactly these five inputs and nowhere else.
    for (let length = 0; length <= 130; length += 1) {
      const input = "a".repeat(length);
      expect(sha256HexFallback(input), `length ${length}`).toBe(
        reference(input),
      );
    }
  });

  it("agrees with Node on the strings this is actually asked about", () => {
    // What the solver hashes: a base64url nonce with a number stuck on it.
    for (const nonce of ["b9VdKq3zR1sN7pQwXyZ0Ag", "short", "a-b_c"]) {
      for (const number of [0, 7, 4242, 149999]) {
        const input = `${nonce}${number}`;
        expect(sha256HexFallback(input), input).toBe(reference(input));
      }
    }
  });
});

describe("sha256Hex", () => {
  it("gives the same answer as Node, whichever path it took", async () => {
    for (const input of ["", "abc", "b9VdKq3zR1sN7pQwXyZ0Ag91422"]) {
      expect(await sha256Hex(input)).toBe(reference(input));
    }
  });
});

describe("solveProofOfWork", () => {
  const nonce = "b9VdKq3zR1sN7pQwXyZ0Ag";

  it("finds the number the server was thinking of", async () => {
    // Built exactly as `issueProofOfWork` builds it, so this is the round trip
    // rather than a restatement of one half of it.
    const answer = 1337;
    const target = reference(`${nonce}${answer}`);

    expect(await solveProofOfWork(nonce, target, 5000)).toBe(answer);
  });

  it("finds one that lands on a batch boundary", async () => {
    // The search hashes in batches of 500 and reads the hit out of the batch by
    // index; an off-by-one there would miss exactly the first of a batch.
    for (const answer of [0, 499, 500, 501, 1000]) {
      const target = reference(`${nonce}${answer}`);
      expect(await solveProofOfWork(nonce, target, 2000), `${answer}`).toBe(
        answer,
      );
    }
  });

  it("searches up to and including the ceiling it was given", async () => {
    const target = reference(`${nonce}${750}`);
    expect(await solveProofOfWork(nonce, target, 750)).toBe(750);
  });

  it("gives up rather than looping when there is no answer", async () => {
    expect(await solveProofOfWork(nonce, "not-a-hash", 1000)).toBeNull();
  });
});
