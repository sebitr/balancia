import { describe, expect, it } from "vitest";
import {
  asciiFold,
  buildEmvcoPayload,
  crc16CcittFalse,
  emvcoAmount,
  emvcoField,
  emvcoTemplate,
} from "./emvco";

/**
 * The container, tested apart from any scheme that uses it.
 *
 * The checksum is anchored to the published check value rather than to
 * something this repository produced: CRC-16/CCITT-FALSE over "123456789" is
 * 0x29B1, which is the constant every implementation of it is verified with.
 * Asserting against our own output would only prove the function is
 * deterministic, which was never in doubt.
 */

describe("the checksum", () => {
  it("matches the published check value for CRC-16/CCITT-FALSE", () => {
    expect(crc16CcittFalse("123456789")).toBe("29B1");
  });

  it("is four uppercase hex digits, padded", () => {
    // The specification is explicit about the width and the case, and readers
    // that compare the string rather than the number are why it matters.
    for (const input of ["", "A", "pix", "00020101"]) {
      expect(crc16CcittFalse(input)).toMatch(/^[0-9A-F]{4}$/);
    }
  });

  it("covers its own identifier and length", () => {
    // The classic mistake is computing it over the payload without the "6304"
    // that introduces it, which produces a code that scans and then fails.
    const payload = buildEmvcoPayload([emvcoField("00", "01")]);
    expect(payload).toBe(`0002016304${crc16CcittFalse("0002016304")}`);
  });
});

describe("a field", () => {
  it("writes the identifier, a two-digit length, then the value", () => {
    expect(emvcoField("00", "01")).toBe("000201");
    expect(emvcoField("59", "Lea Martin")).toBe("5910Lea Martin");
  });

  it("pads the length rather than trusting it to be two digits already", () => {
    expect(emvcoField("62", "x".repeat(7))).toBe("6207xxxxxxx");
    expect(emvcoField("62", "x".repeat(12))).toBe(`6212${"x".repeat(12)}`);
  });

  it("refuses what it cannot measure honestly", () => {
    // A length is characters and is read as bytes; anything outside ASCII
    // makes those two different numbers and walks a reader into the next field.
    expect(emvcoField("59", "Léa Martin")).toBeNull();
    expect(emvcoField("59", "")).toBeNull();
    expect(emvcoField("59", "x".repeat(100))).toBeNull();
    expect(emvcoField("5", "x")).toBeNull();
  });
});

describe("a template", () => {
  it("nests its children inside one value", () => {
    expect(
      emvcoTemplate("26", [
        { id: "00", value: "br.gov.bcb.pix" },
        { id: "01", value: "lea@example.com" },
      ]),
    ).toBe("2637" + "0014br.gov.bcb.pix" + "0115lea@example.com");
  });

  it("fails whole rather than partially", () => {
    // A template missing a child the scheme requires is not a smaller
    // template; it is a different one.
    expect(
      emvcoTemplate("26", [
        { id: "00", value: "br.gov.bcb.pix" },
        { id: "01", value: "" },
      ]),
    ).toBeNull();
  });
});

describe("the payload", () => {
  it("refuses when any field could not be written", () => {
    expect(buildEmvcoPayload([emvcoField("00", "01"), null])).toBeNull();
    expect(buildEmvcoPayload([])).toBeNull();
  });
});

describe("folding a name to ASCII", () => {
  it("removes accents rather than replacing the letter", () => {
    expect(asciiFold("Léa Martin")).toBe("Lea Martin");
    expect(asciiFold("Genève")).toBe("Geneve");
    expect(asciiFold("Jörg Müller")).toBe("Jorg Muller");
  });

  it("handles the letters a decomposition cannot reach", () => {
    // These are not accented letters — the stroke is part of the glyph — so
    // NFD leaves them alone and they need saying explicitly.
    expect(asciiFold("Łukasz")).toBe("Lukasz");
    expect(asciiFold("Søren")).toBe("Soren");
    expect(asciiFold("Weiß")).toBe("Weiss");
  });

  it("collapses the whitespace a name was typed with", () => {
    expect(asciiFold("  Léa   Martin ")).toBe("Lea Martin");
  });
});

describe("the amount", () => {
  it("writes the currency's own number of places", () => {
    expect(emvcoAmount("8420", 2)).toBe("84.20");
    expect(emvcoAmount("5", 2)).toBe("0.05");
    expect(emvcoAmount("100000", 2)).toBe("1000.00");
  });

  it("keeps trailing zeros, which every reference payload has", () => {
    expect(emvcoAmount("1000", 2)).toBe("10.00");
  });

  it("writes no point at all for a currency with no minor unit", () => {
    expect(emvcoAmount("1200", 0)).toBe("1200");
  });
});
