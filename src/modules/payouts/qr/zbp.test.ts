import { describe, expect, it } from "vitest";
import { buildZbpQrPayload, type ZbpQrInput } from "./zbp";

/**
 * The Polish code: eight pipe-separated fields, no keys and no checksum.
 *
 * That last part is why the assertions are positional and why the separator
 * matters so much. With no keys, a stray pipe does not corrupt a field — it
 * shifts every field after it by one, and the result still parses. Silent and
 * wrong is the only failure mode this format has.
 */

const input: ZbpQrInput = {
  iban: "PL61 1090 1014 0000 0712 1981 2874",
  creditorName: "Łukasz Nowak",
  minorUnits: "8420",
  currency: "PLN",
  message: "Rzym 2026",
};

const build = (overrides: Partial<ZbpQrInput> = {}) =>
  buildZbpQrPayload({ ...input, ...overrides });

const fields = (overrides: Partial<ZbpQrInput> = {}) => {
  const payload = build(overrides);
  if (payload === null) throw new Error("expected a payload");
  return payload.split("|");
};

describe("the payload", () => {
  it("has eight fields, whatever is in them", () => {
    expect(fields()).toHaveLength(8);
  });

  it("leaves the tax identifier empty, because a person has none", () => {
    expect(fields()[0]).toBe("");
  });

  it("writes the NRB, not the IBAN", () => {
    // The trap this format invites: the full IBAN here scans into a rejected
    // transfer, because the field wants the 26 digits after the country code.
    const account = fields()[2]!;
    expect(account).toBe("61109010140000071219812874");
    expect(account).toHaveLength(26);
    expect(account.startsWith("PL")).toBe(false);
  });

  it("writes the amount in grosz, exactly as it is stored", () => {
    // The one field in this directory where nothing is formatted, so nothing
    // can be lost in formatting.
    expect(fields()[3]).toBe("008420");
    expect(fields({ minorUnits: "5" })[3]).toBe("000005");
  });

  it("folds the name and cuts it to the field", () => {
    expect(fields()[4]).toBe("Lukasz Nowak");
    expect(fields({ creditorName: "Aleksandra".repeat(5) })[4]!.length).toBe(
      20,
    );
  });

  it("takes out the separator", () => {
    // A pipe here would shift the title into the reserved field and the code
    // would still parse — with the wrong things in the wrong places.
    expect(fields({ message: "Rzym | 2026" })).toHaveLength(8);
    expect(fields({ message: "Rzym | 2026" })[5]).toBe("Rzym 2026");
  });
});

describe("refusing", () => {
  it("leaves euros to the Girocode", () => {
    expect(build({ currency: "EUR" })).toBeNull();
  });

  it("refuses an account that is not Polish", () => {
    expect(build({ iban: "DE89 3704 0044 0532 0130 00" })).toBeNull();
  });

  it("refuses a debt too large for the field", () => {
    // Six digits of grosz stops at 9 999,99 zł. A code that dropped the
    // leading digit would ask for a tenth of the debt and look reasonable.
    expect(build({ minorUnits: "999999" })).not.toBeNull();
    expect(build({ minorUnits: "1000000" })).toBeNull();
  });

  it("refuses a debt of nothing", () => {
    expect(build({ minorUnits: "0" })).toBeNull();
    expect(build({ minorUnits: "-500" })).toBeNull();
  });
});
