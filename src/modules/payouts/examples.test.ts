import { describe, expect, it } from "vitest";
import { AsYouType, parsePhoneNumber } from "libphonenumber-js/max";
import { PAYMENT_METHOD_IDS } from "@/modules/settlements/payment-methods";
import { payoutFieldFor, validatePayoutDetail } from "./fields";
import {
  countryForPayoutMethod,
  payoutExampleFor,
  phoneExampleFor,
  IBAN_BY_COUNTRY,
  PHONE_BY_COUNTRY,
} from "./examples";

/**
 * The examples, and whether they are true.
 *
 * A placeholder is read as an instruction, so every one of these is a claim
 * about somebody's country: this is how a number is written where you are.
 * The claims are checked here rather than eyeballed, because the way they go
 * wrong — a digit too many for the numbering plan, a check digit that does
 * not add up — is invisible to anybody who does not already know the answer.
 *
 * The full metadata is used, which is heavier than the app ships and exactly
 * what a test should be doing: the browser only needs to group digits, while
 * this needs to know that +41 79 is a mobile range.
 */

describe("example numbers", () => {
  it("gives every country a real mobile number of its own", () => {
    for (const [country, example] of Object.entries(PHONE_BY_COUNTRY)) {
      const number = parsePhoneNumber(example);
      expect(number.country, example).toBe(country);
      expect(number.isValid(), example).toBe(true);
      // North America does not separate the two, and everywhere else here is
      // a mobile range — which is the one that matters, since every scheme
      // these examples appear under is built on a phone somebody carries.
      expect(["MOBILE", "FIXED_LINE_OR_MOBILE"], example).toContain(
        number.getType(),
      );
    }
  });

  it("writes each one the way the field will write it as it is typed", () => {
    // Otherwise the example reshapes itself the moment somebody types over
    // it, which reads as the field correcting them before they have finished.
    for (const example of Object.values(PHONE_BY_COUNTRY)) {
      expect(new AsYouType().input(example)).toBe(example);
    }
  });

  it("gives every method that asks for a number a country to be from", () => {
    // A phone scheme added to the catalogue without an entry here would show
    // whatever the reader's timezone suggested, and a Swiss example under an
    // Italian wallet is the bug this whole file exists to fix.
    const orphans = PAYMENT_METHOD_IDS.filter(
      (id) =>
        payoutFieldFor(id) === "phone" &&
        countryForPayoutMethod(id, null) === null,
    );

    expect(orphans).toEqual([]);
  });
});

describe("example IBANs", () => {
  it("offers only IBANs the app itself would accept", () => {
    // The checksum is what a transposed digit fails, and a placeholder is
    // exactly the string somebody types over the top of.
    for (const [country, example] of Object.entries(IBAN_BY_COUNTRY)) {
      expect(validatePayoutDetail("bank", example), example).toBeNull();
      expect(example.startsWith(country), example).toBe(true);
    }
  });
});

describe("payoutExampleFor", () => {
  it("shows the method's own country, whoever is reading", () => {
    // The headline case: Satispay is Italian, and somebody who uses it has
    // never had a +41 number.
    expect(payoutExampleFor("satispay", "CH")).toBe(PHONE_BY_COUNTRY.IT);
    expect(payoutExampleFor("twint", "IT")).toBe(PHONE_BY_COUNTRY.CH);
    expect(payoutExampleFor("bizum", null)).toBe(PHONE_BY_COUNTRY.ES);
  });

  it("follows the reader for a method that runs in several countries", () => {
    expect(payoutExampleFor("mobilepay", "FI")).toBe(PHONE_BY_COUNTRY.FI);
    expect(payoutExampleFor("wero", "DE")).toBe(PHONE_BY_COUNTRY.DE);
    // Somewhere the scheme does not reach: the first country it does.
    expect(payoutExampleFor("mobilepay", "CH")).toBe(PHONE_BY_COUNTRY.DK);
  });

  it("takes the reader's country for a transfer, which has none", () => {
    expect(payoutExampleFor("bank", "IT")).toBe(IBAN_BY_COUNTRY.IT);
    expect(payoutExampleFor("bank", null)).toBe(IBAN_BY_COUNTRY.CH);
    // Four countries here have no IBANs at all. The field takes one anyway,
    // so the example says what it will accept rather than nothing.
    expect(payoutExampleFor("bank", "US")).toBe(IBAN_BY_COUNTRY.CH);
  });

  it("says nothing about a detail that looks the same everywhere", () => {
    // A Revtag, an email address and a PayPal.me link are the catalogue's
    // business, and the words in them are translated.
    expect(payoutExampleFor("revolut", "IT")).toBeNull();
    expect(payoutExampleFor("paypal", "IT")).toBeNull();
    expect(payoutExampleFor("zelle", "US")).toBeNull();
    expect(payoutExampleFor("cash", "CH")).toBeNull();
  });

  it("has an answer for a method invented tomorrow", () => {
    expect(payoutExampleFor("a-method-invented-tomorrow", "IT")).toBeNull();
    expect(phoneExampleFor("a-method-invented-tomorrow", "IT")).toBe(
      PHONE_BY_COUNTRY.IT,
    );
    expect(phoneExampleFor("a-method-invented-tomorrow", null)).toBe(
      PHONE_BY_COUNTRY.CH,
    );
  });
});
