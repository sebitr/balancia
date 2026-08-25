import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { buildPaymentQr, explainMissingQr } from "./payment-qr";

/**
 * Which standard, and — more often — neither.
 *
 * The two schemes do not compete: a Swiss banking app reads the QR-bill and
 * not the Girocode, and the rest of SEPA the other way round. So the account
 * decides, never a preference, and anything that cannot be built correctly is
 * not built at all. What people do with a payment QR is trust it.
 */

const swiss = {
  iban: "CH93 0076 2011 6238 5295 7",
  creditorName: "Léa Martin",
  address: {
    street: "Rue du Rhône",
    buildingNumber: "12",
    postalCode: "1204",
    town: "Genève",
    country: "CH",
  },
  minorUnits: "8420",
  currency: "CHF",
  message: "Weekend in Verbier",
};

const european = {
  ...swiss,
  iban: "DE89 3704 0044 0532 0130 00",
  address: null,
  currency: "EUR",
};

describe("choosing a standard", () => {
  it("gives a Swiss account the Swiss QR-bill", () => {
    const qr = buildPaymentQr(swiss);
    expect(qr?.standard).toBe("swiss");
    expect(qr?.payload.split("\n")[0]).toBe("SPC");
  });

  it("gives a European account the Girocode", () => {
    const qr = buildPaymentQr(european);
    expect(qr?.standard).toBe("epc");
    expect(qr?.payload.split("\n")[0]).toBe("BCD");
  });

  it("never falls back from one scheme to the other", () => {
    // A Swiss bank does not read a Girocode, so a Swiss account with no
    // address gets nothing rather than a code that scans into nothing.
    expect(buildPaymentQr({ ...swiss, address: null })).toBeNull();
  });
});

describe("refusing", () => {
  it("says nothing can be built without the address the standard requires", () => {
    expect(explainMissingQr({ ...swiss, address: null })).toBe(
      "addressMissing",
    );
  });

  it("names the QR-IBAN case, which is the bank's doing and not the user's", () => {
    const qrIban = { ...swiss, iban: "CH44 3199 9123 0008 8901 2" };
    expect(buildPaymentQr(qrIban)).toBeNull();
    expect(explainMissingQr(qrIban)).toBe("qrIban");
  });

  it("refuses a currency neither standard carries", () => {
    expect(buildPaymentQr({ ...swiss, currency: "USD" })).toBeNull();
    expect(explainMissingQr({ ...swiss, currency: "USD" })).toBe("currency");
    // The Girocode is euro-only, so a sterling debt to a British account has
    // no code either.
    expect(
      buildPaymentQr({
        ...european,
        iban: "GB82 WEST 1234 5698 7654 32",
        currency: "GBP",
      }),
    ).toBeNull();
  });

  it("has nothing to explain when a code was built", () => {
    expect(explainMissingQr(swiss)).toBe("none");
    expect(explainMissingQr(european)).toBe("none");
  });
});

describe("what the encoder makes of them", () => {
  it("keeps a Girocode within the version the guidelines allow", () => {
    // EPC069-12 caps the symbol at version 13 at error correction M, which is
    // what the 331-byte payload limit is really protecting.
    const qr = buildPaymentQr({
      ...european,
      message: "x".repeat(140),
    });
    const matrix = encode(qr!.payload, { ecc: "M", border: 0 });
    expect(matrix.version).toBeLessThanOrEqual(13);
  });

  it("encodes a full Swiss payload at all", () => {
    const qr = buildPaymentQr({
      ...swiss,
      creditorName: "É".repeat(70),
      message: "y".repeat(140),
    });
    const matrix = encode(qr!.payload, { ecc: "M", border: 0 });
    // Well inside the 997 alphanumeric characters the standard budgets for.
    expect(matrix.version).toBeLessThanOrEqual(25);
  });
});
