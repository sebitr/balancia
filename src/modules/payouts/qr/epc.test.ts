import { describe, expect, it } from "vitest";
import { buildEpcQrPayload, type EpcQrInput } from "./epc";

/**
 * The EPC QR code, line by line.
 *
 * Same rule as the Swiss one: a reader takes line 8 as the amount whatever was
 * meant, so the assertions are on positions. The interesting cases are the two
 * refusals — a currency the standard cannot express, and a payload past the
 * 331 bytes a reader is allowed to assume.
 */

const input: EpcQrInput = {
  iban: "DE89 3704 0044 0532 0130 00",
  creditorName: "Léa Martin",
  minorUnits: "8420",
  currency: "EUR",
  remittance: "Weekend in Verbier",
};

const lines = (overrides: Partial<EpcQrInput> = {}) => {
  const payload = buildEpcQrPayload({ ...input, ...overrides });
  if (payload === null) throw new Error("expected a payload");
  return payload.split("\n");
};

describe("the fixed head", () => {
  it("declares the service, version, encoding and transfer type", () => {
    const out = lines();
    expect(out[0]).toBe("BCD");
    // 002 rather than 001, which is what makes the BIC optional — and a
    // shared-expense app has no business deriving a BIC from an IBAN.
    expect(out[1]).toBe("002");
    expect(out[2]).toBe("1");
    expect(out[3]).toBe("SCT");
  });

  it("leaves the BIC empty unless it is given one", () => {
    expect(lines()[4]).toBe("");
    expect(lines({ bic: "COBADEFFXXX" })[4]).toBe("COBADEFFXXX");
  });
});

describe("the beneficiary", () => {
  it("writes the name then the IBAN, without spaces", () => {
    const out = lines();
    expect(out[5]).toBe("Léa Martin");
    expect(out[6]).toBe("DE89370400440532013000");
  });

  it("refuses without a name, which the standard makes mandatory", () => {
    expect(buildEpcQrPayload({ ...input, creditorName: "  " })).toBeNull();
  });

  it("cuts a name to the seventy characters allowed", () => {
    expect(lines({ creditorName: "é".repeat(100) })[5]).toHaveLength(70);
  });
});

describe("the amount", () => {
  it("is the currency and the value, with a dot", () => {
    expect(lines()[7]).toBe("EUR84.20");
  });

  it("keeps both decimals on a round amount", () => {
    expect(lines({ minorUnits: "10000" })[7]).toBe("EUR100.00");
  });

  it("refuses any currency but the euro", () => {
    // The element is defined as EUR. A code with no amount would still be
    // valid, but it would ask somebody to type the number themselves — which
    // is the mistake the code exists to prevent.
    expect(buildEpcQrPayload({ ...input, currency: "CHF" })).toBeNull();
    expect(buildEpcQrPayload({ ...input, currency: "GBP" })).toBeNull();
  });

  it("refuses an amount outside the range the guidelines give", () => {
    expect(buildEpcQrPayload({ ...input, minorUnits: "0" })).toBeNull();
    expect(
      buildEpcQrPayload({ ...input, minorUnits: "100000000000" }),
    ).toBeNull();
  });
});

describe("the remittance", () => {
  it("carries free text on the last line", () => {
    expect(lines()[10]).toBe("Weekend in Verbier");
  });

  it("sends a structured reference instead of the text, never both", () => {
    // Sending both is what makes a reader pick one arbitrarily.
    const out = lines({ reference: "RF18539007547034", remittance: "ignored" });
    expect(out[9]).toBe("RF18539007547034");
    expect(out[10] ?? "").toBe("");
  });

  it("drops trailing empty lines rather than padding the payload", () => {
    // "The last populated element is not followed by any character."
    const out = lines({ remittance: null, reference: null });
    expect(out).toHaveLength(8);
    expect(out[7]).toBe("EUR84.20");
  });
});

describe("the size limit", () => {
  it("refuses a payload past 331 bytes", () => {
    // Counted in bytes, so accented characters cost more than their length.
    expect(
      buildEpcQrPayload({
        ...input,
        creditorName: "é".repeat(70),
        remittance: "é".repeat(140),
      }),
    ).toBeNull();
  });

  it("accepts one that fits", () => {
    expect(
      buildEpcQrPayload({ ...input, remittance: "x".repeat(140) }),
    ).not.toBeNull();
  });
});
