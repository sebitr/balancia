import { describe, expect, it } from "vitest";
import { buildSpaydQrPayload, type SpaydQrInput } from "./spayd";

/**
 * SPAYD, which exists here because the Girocode is euros only.
 *
 * Parsed back into keys rather than compared as a string: the order the fields
 * are written in is a convention, and pinning a test to it would fail the next
 * time somebody reorders them for a reader that wants them differently.
 */

const input: SpaydQrInput = {
  iban: "CZ65 0800 0000 1920 0014 5399",
  creditorName: "Léa Martin",
  minorUnits: "45000",
  currency: "CZK",
  message: "Večeře v Praze",
};

const build = (overrides: Partial<SpaydQrInput> = {}) =>
  buildSpaydQrPayload({ ...input, ...overrides });

function parse(payload: string): Record<string, string> {
  const [header, version, ...fields] = payload.split("*");
  expect(header).toBe("SPD");
  expect(version).toBe("1.0");
  return Object.fromEntries(
    fields.map((field) => {
      const at = field.indexOf(":");
      return [field.slice(0, at), field.slice(at + 1)];
    }),
  );
}

describe("the payload", () => {
  it("opens with the header the format is recognised by", () => {
    expect(build()!.startsWith("SPD*1.0*")).toBe(true);
  });

  it("carries the account, the amount and the currency", () => {
    const fields = parse(build()!);
    // Compacted and upper-cased: people paste IBANs in groups of four.
    expect(fields["ACC"]).toBe("CZ6508000000192000145399");
    expect(fields["AM"]).toBe("450.00");
    expect(fields["CC"]).toBe("CZK");
  });

  it("folds the message and the name to ASCII", () => {
    // A reader that meets "Večeře" either drops the payload or renders noise;
    // neither tells the payer what they are paying for, while "Vecere" does.
    const fields = parse(build()!);
    expect(fields["MSG"]).toBe("Vecere v Praze");
    expect(fields["RN"]).toBe("Lea Martin");
  });

  it("takes out the separator rather than escaping it", () => {
    // There is no escape readers agree on, and a stray asterisk would turn one
    // field into two — the second read as an unknown key and dropped.
    const fields = parse(build({ message: "Rome *2026*" })!);
    expect(fields["MSG"]).toBe("Rome 2026");
  });

  it("omits a field it has nothing for, rather than writing it empty", () => {
    expect(parse(build({ message: "   " })!)["MSG"]).toBeUndefined();
  });
});

describe("refusing", () => {
  it("leaves euros to the Girocode", () => {
    // Two codes for one debt is a choice the payer should not have to make.
    expect(build({ currency: "EUR" })).toBeNull();
  });

  it("refuses an account that is not Czech", () => {
    expect(build({ iban: "DE89 3704 0044 0532 0130 00" })).toBeNull();
  });

  it("refuses a debt of nothing", () => {
    expect(build({ minorUnits: "0" })).toBeNull();
    expect(build({ minorUnits: "-4500" })).toBeNull();
  });
});
