import { describe, expect, it } from "vitest";
import { minorUnitsFor } from "./minor-units";

/**
 * The conversion a caller without an ISO 4217 table would otherwise guess at.
 *
 * Every case below is one a shortcut can actually reach by dictating a
 * sentence, which is why the exponents are the interesting part: the whole
 * reason this lives on the server is that "multiply by a hundred" is right for
 * three quarters of the world's currencies and wrong for the rest.
 */
describe("minorUnitsFor", () => {
  it.each([
    ["24.50", "EUR", "2450"],
    ["24.5", "EUR", "2450"],
    ["24", "EUR", "2400"],
    ["0.05", "EUR", "5"],
    // Zero decimals: a hundredth of a yen is not a thing, so 4500 yen is 4500
    // minor units and not 450000.
    ["4500", "JPY", "4500"],
    // Three: the dinar is the case that makes a hardcoded factor of 100 lose
    // an order of magnitude rather than a rounding.
    ["12.345", "KWD", "12345"],
    ["12.3", "KWD", "12300"],
    ["1000000", "EUR", "100000000"],
  ])("reads %s %s as %s minor units", (amountText, currency, expected) => {
    expect(minorUnitsFor(amountText, currency)).toBe(expected);
  });

  it("says nothing when the sentence held no amount", () => {
    expect(minorUnitsFor("", "EUR")).toBeNull();
  });

  it("says nothing when no currency was heard and none was offered", () => {
    // The share-sheet case: the caller picks the group afterwards, and only
    // then knows which currency the figure is in.
    expect(minorUnitsFor("24.50", "")).toBeNull();
  });

  it("refuses more decimals than the currency has, rather than truncating", () => {
    // "24.50 yen" is somebody misspeaking or a recogniser inventing, and
    // answering 24 would quietly lose the rest.
    expect(minorUnitsFor("24.50", "JPY")).toBeNull();
    expect(minorUnitsFor("1.2345", "EUR")).toBeNull();
  });

  it("says nothing about text that is not a plain decimal", () => {
    // The parser hands its amount through unchanged, so a grouped figure that
    // survived recognition reaches here as-is.
    expect(minorUnitsFor("1,234.50", "EUR")).toBeNull();
    expect(minorUnitsFor("about twelve", "EUR")).toBeNull();
  });
});
