import { describe, expect, it } from "vitest";
import { PAYMENT_METHOD_IDS } from "@/modules/settlements/payment-methods";
import {
  needsDetail,
  normalizePayoutDetail,
  payoutFieldFor,
  validatePayoutDetail,
} from "./fields";

/**
 * The shapes, and the one that earns its keep.
 *
 * A payout detail is read by somebody else, in another app, with money in
 * hand. The checksum below is the difference between a typo caught while the
 * owner is still looking at the field and a payment that silently goes nowhere.
 */

describe("payoutFieldFor", () => {
  it("asks for nothing where there is nobody to send to", () => {
    expect(payoutFieldFor("cash")).toBe("none");
    expect(payoutFieldFor("cheque")).toBe("none");
    expect(needsDetail("cash")).toBe(false);
  });

  it("knows the regional schemes by what they are built on", () => {
    expect(payoutFieldFor("twint")).toBe("phone");
    expect(payoutFieldFor("bank")).toBe("iban");
    expect(payoutFieldFor("wise")).toBe("email");
    expect(payoutFieldFor("revolut")).toBe("handle");
    expect(payoutFieldFor("paypal")).toBe("link");
  });

  it("falls back to an unopinionated field rather than to nothing", () => {
    // A method added to the vocabulary without a thought here still works.
    expect(payoutFieldFor("crypto")).toBe("text");
    expect(payoutFieldFor("a-method-invented-tomorrow")).toBe("text");
  });

  it("has an opinion, or a safe default, for every method offered", () => {
    for (const id of PAYMENT_METHOD_IDS) {
      expect(payoutFieldFor(id)).toBeTruthy();
    }
  });
});

describe("validatePayoutDetail", () => {
  it("accepts nothing at all for cash", () => {
    expect(validatePayoutDetail("cash", "")).toBeNull();
  });

  it("insists on a detail for everything else", () => {
    expect(validatePayoutDetail("twint", "")).toBe("required");
    expect(validatePayoutDetail("twint", "   ")).toBe("required");
  });

  it("requires the country code on a phone number", () => {
    expect(validatePayoutDetail("twint", "+41 79 123 45 67")).toBeNull();
    // Dialable only from inside the country that issued it, which defeats
    // writing it down for somebody abroad.
    expect(validatePayoutDetail("twint", "079 123 45 67")).toBe("phone");
    // Seven digits is E.164's own floor and is a real number somewhere, so
    // the rule cannot be stricter than that without refusing whole countries.
    // What it does refuse is shorter than any number, and a country code that
    // starts with a zero, which no country's does.
    expect(validatePayoutDetail("twint", "+41 79")).toBe("phone");
    expect(validatePayoutDetail("twint", "+041 79 123 45 67")).toBe("phone");
  });

  it("checks an IBAN with its own checksum", () => {
    expect(
      validatePayoutDetail("bank", "CH93 0076 2011 6238 5295 7"),
    ).toBeNull();
    expect(
      validatePayoutDetail("bank", "GB82 WEST 1234 5698 7654 32"),
    ).toBeNull();
  });

  it("catches the two mistakes people actually make in an IBAN", () => {
    // One digit wrong, and two adjacent characters swapped. Both pass a length
    // check and fail mod-97, which is the whole reason the checksum exists.
    expect(validatePayoutDetail("bank", "CH93 0076 2011 6238 5295 8")).toBe(
      "iban",
    );
    expect(validatePayoutDetail("bank", "CH93 0076 2011 6238 5952 7")).toBe(
      "iban",
    );
  });

  it("refuses an IBAN that is not shaped like one at all", () => {
    expect(validatePayoutDetail("bank", "my bank account")).toBe("iban");
    expect(validatePayoutDetail("bank", "1234567890")).toBe("iban");
  });

  it("checks an address where the method is an address", () => {
    expect(validatePayoutDetail("wise", "seb@hey.ch")).toBeNull();
    expect(validatePayoutDetail("wise", "seb at hey")).toBe("email");
  });

  it("takes a payment link with or without its scheme", () => {
    expect(validatePayoutDetail("paypal", "paypal.me/sebtr")).toBeNull();
    expect(
      validatePayoutDetail("paypal", "https://paypal.me/sebtr"),
    ).toBeNull();
    expect(validatePayoutDetail("paypal", "sebtr")).toBe("link");
  });

  it("does not second-guess a handle's shape", () => {
    // The provider owns it, and inventing a pattern would reject valid ones.
    expect(validatePayoutDetail("revolut", "@sebtr")).toBeNull();
    expect(validatePayoutDetail("upi", "seb@okaxis")).toBeNull();
    expect(validatePayoutDetail("crypto", "bc1q…")).toBeNull();
  });

  it("caps what it will store", () => {
    expect(validatePayoutDetail("revolut", "@" + "a".repeat(200))).toBe(
      "tooLong",
    );
  });
});

describe("normalizePayoutDetail", () => {
  it("strips the spacing people read numbers out in", () => {
    expect(normalizePayoutDetail("twint", "+41 79 123 45 67")).toBe(
      "+41791234567",
    );
    expect(normalizePayoutDetail("bank", "ch93 0076 2011 6238 5295 7")).toBe(
      "CH930076201162385295 7".replace(/\s/g, ""),
    );
  });

  it("leaves a handle exactly as its owner typed it", () => {
    // Capitals in a Revtag are its owner's business, not ours.
    expect(normalizePayoutDetail("revolut", " @SebTR ")).toBe("@SebTR");
  });

  it("stores nothing for a method that carries nothing", () => {
    expect(normalizePayoutDetail("cash", "ignored")).toBe("");
  });
});
