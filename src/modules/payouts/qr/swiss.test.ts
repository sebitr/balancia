import { describe, expect, it } from "vitest";
import { buildSwissQrPayload, isQrIban, type SwissQrInput } from "./swiss";

/**
 * The Swiss QR Code, checked line by line.
 *
 * Line positions are the whole specification: a bank reads line 19 as the
 * amount whatever we meant to put there, so the assertions below are on
 * indices rather than on "contains". The refusals matter as much as the
 * output — a code that cannot be built correctly must not be built, because
 * what people do with a payment QR is trust it.
 */

const input: SwissQrInput = {
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

const lines = (overrides: Partial<SwissQrInput> = {}) => {
  const payload = buildSwissQrPayload({ ...input, ...overrides });
  if (payload === null) throw new Error("expected a payload");
  return payload.split("\n");
};

describe("the header and the account", () => {
  it("opens with the fixed identifier, version and coding", () => {
    const out = lines();
    expect(out[0]).toBe("SPC");
    expect(out[1]).toBe("0200");
    expect(out[2]).toBe("1");
  });

  it("writes the IBAN without spaces", () => {
    expect(lines()[3]).toBe("CH9300762011623852957");
  });
});

describe("the creditor", () => {
  it("declares a structured address, the only kind still accepted", () => {
    expect(lines()[4]).toBe("S");
  });

  it("puts the name, street, number, postcode, town and country in order", () => {
    const out = lines();
    expect(out[5]).toBe("Léa Martin");
    expect(out[6]).toBe("Rue du Rhône");
    expect(out[7]).toBe("12");
    expect(out[8]).toBe("1204");
    expect(out[9]).toBe("Genève");
    expect(out[10]).toBe("CH");
  });

  it("keeps street and building number optional", () => {
    const out = lines({
      address: { ...input.address, street: null, buildingNumber: null },
    });
    expect(out[6]).toBe("");
    expect(out[7]).toBe("");
    // The lines the guidelines mark as always required are still there.
    expect(out[8]).toBe("1204");
    expect(out[9]).toBe("Genève");
  });

  it("refuses to build without a postcode, a town or a country", () => {
    const address = input.address;
    expect(
      buildSwissQrPayload({
        ...input,
        address: { ...address, postalCode: "" },
      }),
    ).toBeNull();
    expect(
      buildSwissQrPayload({ ...input, address: { ...address, town: "" } }),
    ).toBeNull();
    expect(
      buildSwissQrPayload({ ...input, address: { ...address, country: "" } }),
    ).toBeNull();
  });

  it("leaves the ultimate creditor group empty, as the guidelines require", () => {
    const out = lines();
    expect(out.slice(11, 18)).toEqual(["", "", "", "", "", "", ""]);
  });
});

describe("the amount", () => {
  it("writes it with a dot and two decimals, on its own line", () => {
    const out = lines();
    expect(out[18]).toBe("84.20");
    expect(out[19]).toBe("CHF");
  });

  it("allows an open amount, which means the payer decides", () => {
    expect(lines({ minorUnits: null })[18]).toBe("");
  });

  it("refuses an amount of zero or less rather than sending one", () => {
    expect(buildSwissQrPayload({ ...input, minorUnits: "0" })).toBeNull();
    expect(buildSwissQrPayload({ ...input, minorUnits: "-100" })).toBeNull();
  });

  it("takes only the two currencies the standard carries", () => {
    expect(buildSwissQrPayload({ ...input, currency: "EUR" })).not.toBeNull();
    expect(buildSwissQrPayload({ ...input, currency: "USD" })).toBeNull();
    expect(buildSwissQrPayload({ ...input, currency: "GBP" })).toBeNull();
  });
});

describe("the reference and the message", () => {
  it("says there is no structured reference, and leaves the field empty", () => {
    const out = lines();
    expect(out[27]).toBe("NON");
    // "The element must not be filled for the reference type NON."
    expect(out[28]).toBe("");
  });

  it("carries the message unstructured, capped at 140 characters", () => {
    expect(lines()[29]).toBe("Weekend in Verbier");
    expect(lines({ message: "x".repeat(200) })[29]).toHaveLength(140);
  });

  it("ends the payment data with the trailer", () => {
    const out = lines();
    expect(out[30]).toBe("EPD");
    expect(out).toHaveLength(31);
  });
});

describe("the accounts it will not serve", () => {
  it("refuses anything but a Swiss or Liechtenstein IBAN", () => {
    // A German account's bank does not read this scheme at all.
    expect(
      buildSwissQrPayload({ ...input, iban: "DE89 3704 0044 0532 0130 00" }),
    ).toBeNull();
    expect(
      buildSwissQrPayload({ ...input, iban: "LI21 0881 0000 2324 013A A" }),
    ).not.toBeNull();
  });

  it("refuses a QR-IBAN, which needs a reference nobody here can mint", () => {
    // Institution ids 30000–31999 are QR-IIDs, and an account behind one may
    // only be credited with a 27-digit QR reference issued per invoice.
    expect(isQrIban("CH44 3199 9123 0008 8901 2")).toBe(true);
    expect(isQrIban("CH93 0076 2011 6238 5295 7")).toBe(false);
    expect(
      buildSwissQrPayload({ ...input, iban: "CH44 3199 9123 0008 8901 2" }),
    ).toBeNull();
  });

  it("treats the boundaries of the QR-IID range as the guidelines state", () => {
    expect(isQrIban("CH21 3000 0000 0000 0000 0")).toBe(true);
    expect(isQrIban("CH21 3199 9000 0000 0000 0")).toBe(true);
    expect(isQrIban("CH21 2999 9000 0000 0000 0")).toBe(false);
    expect(isQrIban("CH21 3200 0000 0000 0000 0")).toBe(false);
  });
});

/**
 * Example 3 from Annex A of the Implementation Guidelines, reproduced.
 *
 * A payment part with an open amount and no structured reference — which is
 * exactly the shape a shared-expense app produces. Asserting against the
 * standard's own worked example is the difference between matching the spec
 * and matching my reading of it.
 */
describe("the guidelines' own example", () => {
  it("reproduces Annex A example 3 line for line", () => {
    const payload = buildSwissQrPayload({
      iban: "CH5204835012345671000",
      creditorName: "Muster Stiftung",
      address: {
        street: "P.O. box",
        buildingNumber: null,
        postalCode: "3001",
        town: "Bern",
        country: "CH",
      },
      minorUnits: null,
      currency: "CHF",
      message: null,
    });

    expect(payload?.split("\n")).toEqual([
      "SPC",
      "0200",
      "1",
      "CH5204835012345671000",
      "S",
      "Muster Stiftung",
      "P.O. box",
      "",
      "3001",
      "Bern",
      "CH",
      // Ultimate creditor: seven empty lines.
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      // An open amount, and the currency.
      "",
      "CHF",
      // Ultimate debtor: seven more.
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "NON",
      "",
      "",
      "EPD",
    ]);
  });
});
