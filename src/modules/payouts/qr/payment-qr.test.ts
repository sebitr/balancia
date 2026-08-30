import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { buildPaymentQr, explainMissingQr } from "./payment-qr";

/**
 * Which standard, and — more often — neither.
 *
 * The schemes do not compete: a Swiss banking app reads the QR-bill and not
 * the Girocode, a Czech one reads SPAYD, a Brazilian one reads a BR Code. So
 * the method and the account decide, never a preference, and anything that
 * cannot be built correctly is not built at all. What people do with a payment
 * QR is trust it.
 */

const swiss = {
  method: "bank",
  detail: "CH93 0076 2011 6238 5295 7",
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
  detail: "DE89 3704 0044 0532 0130 00",
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

  it("prefers a domestic standard where the Girocode could not carry the currency", () => {
    // The whole reason the national formats are here: EPC069-12 is euros only,
    // so without them a koruna or złoty debt has no code at all.
    const czech = buildPaymentQr({
      ...european,
      detail: "CZ65 0800 0000 1920 0014 5399",
      currency: "CZK",
    });
    expect(czech?.standard).toBe("spayd");

    const polish = buildPaymentQr({
      ...european,
      detail: "PL61 1090 1014 0000 0712 1981 2874",
      currency: "PLN",
    });
    expect(polish?.standard).toBe("zbp");
  });

  it("leaves those same accounts to the Girocode when the debt is in euros", () => {
    // A domestic standard fills the gap the Girocode leaves; it does not
    // compete for the payments the Girocode already covers.
    expect(
      buildPaymentQr({
        ...european,
        detail: "CZ65 0800 0000 1920 0014 5399",
        currency: "EUR",
      })?.standard,
    ).toBe("epc");
  });
});

describe("the schemes that are not bank transfers", () => {
  const pix = {
    ...european,
    method: "pix",
    detail: "lea@example.com",
    currency: "BRL",
  };

  it("builds a BR Code from a Pix key", () => {
    const qr = buildPaymentQr(pix);
    expect(qr?.standard).toBe("pix");
    expect(qr?.payload.startsWith("000201")).toBe(true);
    expect(qr?.payload).toContain("br.gov.bcb.pix");
  });

  it("builds a Swish code from a Swedish mobile number", () => {
    const qr = buildPaymentQr({
      ...european,
      method: "swish",
      detail: "+46701234567",
      currency: "SEK",
    });
    expect(qr?.standard).toBe("swish");
    expect(qr?.payload).toBe("C46701234567;84.20;Weekend in Verbier;0");
  });

  it("still has nothing to offer for a scheme with no third-party artefact", () => {
    // A TWINT number is not something anybody scans, and inventing a code for
    // one would be the mistake this whole file exists to avoid.
    expect(
      buildPaymentQr({ ...european, method: "twint", detail: "+41791234567" }),
    ).toBeNull();
    expect(
      explainMissingQr({
        ...european,
        method: "twint",
        detail: "+41791234567",
      }),
    ).toBe("none");
  });

  it("refuses the currency neither scheme can settle in", () => {
    expect(buildPaymentQr({ ...pix, currency: "EUR" })).toBeNull();
    expect(explainMissingQr({ ...pix, currency: "EUR" })).toBe("currency");
  });
});

describe("refusing", () => {
  it("says nothing can be built without the address the standard requires", () => {
    expect(explainMissingQr({ ...swiss, address: null })).toBe(
      "addressMissing",
    );
  });

  it("names the QR-IBAN case, which is the bank's doing and not the user's", () => {
    const qrIban = { ...swiss, detail: "CH44 3199 9123 0008 8901 2" };
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
        detail: "GB82 WEST 1234 5698 7654 32",
        currency: "GBP",
      }),
    ).toBeNull();
  });

  it("has nothing to explain when a code was built", () => {
    expect(explainMissingQr(swiss)).toBe("none");
    expect(explainMissingQr(european)).toBe("none");
  });

  it("has nothing to build from an empty detail", () => {
    expect(buildPaymentQr({ ...european, detail: "  " })).toBeNull();
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

  it("encodes the longest BR Code a key can produce", () => {
    const qr = buildPaymentQr({
      ...european,
      method: "pix",
      // 77 characters is the specification's own ceiling for a key, and the
      // one length that leaves the Pix template with a single spare character.
      detail: `${"k".repeat(68)}@bank.br`,
      currency: "BRL",
      creditorName: "Maria da Silva Ferreira dos Santos",
    });
    const matrix = encode(qr!.payload, { ecc: "M", border: 0 });
    expect(matrix.version).toBeLessThanOrEqual(20);
  });
});
