import { describe, expect, it } from "vitest";
import { fingerprintRow } from "./service";
import type { StagedRow } from "./types";

/**
 * Import fingerprints, pinned.
 *
 * These digests are written to `imported_fingerprints` and read back on every
 * later import, which makes them a storage format rather than an
 * implementation detail: a run that hashes the same row differently from the
 * run before it does not see what it already wrote, and imports a second copy
 * of somebody's money.
 *
 * So the expected values below are literals, taken from the digests this
 * function produced before the separator was moved out of the string literal
 * it was typed into. Changing anything that feeds the hash — the field order,
 * the trimming, the case folding, the separators — fails these, and that
 * failure is the point. If a change to the canonical form is ever genuinely
 * wanted, it needs a migration that rewrites the stored fingerprints, not a
 * new set of literals here.
 */

const guesthouse: StagedRow = {
  kind: "expense",
  description: "Guesthouse",
  date: "2026-02-11",
  amount: "42000",
  currency: "EUR",
  payers: [{ sourceName: "Ada", amount: "42000" }],
  shares: [
    { sourceName: "Ada", amount: "14000" },
    { sourceName: "Blaise", amount: "14000" },
    { sourceName: "Grace", amount: "14000" },
  ],
};

const repayment: StagedRow = {
  kind: "settlement",
  date: "2026-02-20",
  amount: "14000",
  currency: "EUR",
  fromSourceName: "Blaise",
  toSourceName: "Ada",
};

describe("fingerprintRow", () => {
  it("hashes an expense to the digest it has always hashed it to", () => {
    expect(fingerprintRow("group-1", guesthouse)).toBe(
      "073b111e2563b2ac62ff81b82acaa7ec754c414aff0e6d7cd2cf2cf0e645ad8c",
    );
  });

  it("hashes a settlement to the digest it has always hashed it to", () => {
    expect(fingerprintRow("group-1", repayment)).toBe(
      "31b7c4f08a8fd82ee1c06576c7e1643c99e4d8e4230699c52765e5889a945180",
    );
  });

  it("keeps fields apart that could otherwise run together", () => {
    // Every part of the canonical form can hold a "|" or a ":", so only a
    // character no field can contain keeps two different rows distinct.
    expect(
      fingerprintRow("group-1", {
        kind: "expense",
        description: "a|b:c  MIXED case ",
        date: "2026-02-12",
        amount: "1800",
        currency: "EUR",
        payers: [{ sourceName: "Bl|aise", amount: "1800" }],
        shares: [{ sourceName: "Gr:ace", amount: "1800" }],
      }),
    ).toBe("8418eea8770fe0418577281385026b6cea7141145b5c3587d32d786c4c26604f");
  });

  it("scopes a fingerprint to its group", () => {
    expect(fingerprintRow("group-2", guesthouse)).not.toBe(
      fingerprintRow("group-1", guesthouse),
    );
  });

  it("reads the same row the same way whatever order its people arrive in", () => {
    expect(
      fingerprintRow("group-1", {
        ...guesthouse,
        shares: [...guesthouse.shares].reverse(),
      }),
    ).toBe(fingerprintRow("group-1", guesthouse));
  });
});
