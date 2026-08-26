import { describe, expect, it } from "vitest";
import { payoutDeepLink } from "./deep-links";
import { PAYMENT_METHOD_IDS } from "@/modules/settlements/payment-methods";

/**
 * The one thing a payment link must never do is open for the wrong sum.
 *
 * Everything else here is convenience — one tap instead of four, a handle not
 * retyped. But several of these providers take a bare number in a currency
 * they fix themselves, and a link that writes a euro figure into a dollar
 * field is a payment that is wrong by a third and looks entirely correct while
 * it happens. So most of this file is about when the amount is *left off*.
 */

function request(
  overrides: Partial<Parameters<typeof payoutDeepLink>[0]> = {},
) {
  return {
    method: "paypal",
    detail: "paypal.me/seb",
    minorUnits: "8334",
    currency: "EUR",
    ...overrides,
  };
}

describe("PayPal", () => {
  it("carries any currency, because the link says which", () => {
    expect(payoutDeepLink(request())).toEqual({
      href: "https://paypal.me/seb/83.34EUR",
      kind: "universal",
      carriesAmount: true,
    });
  });

  it("keeps a link the owner wrote with its scheme already on", () => {
    expect(
      payoutDeepLink(request({ detail: "https://paypal.me/seb" }))?.href,
    ).toBe("https://paypal.me/seb/83.34EUR");
  });

  it("upgrades http, because this is somebody's money", () => {
    expect(
      payoutDeepLink(request({ detail: "http://paypal.me/seb" }))?.href,
    ).toBe("https://paypal.me/seb/83.34EUR");
  });

  it("leaves a link that is not PayPal's alone", () => {
    // The field takes any payment link. Appending an amount to somebody's own
    // page turns a link that worked into a 404.
    const link = payoutDeepLink(request({ detail: "pay.me/seb" }));

    expect(link?.href).toBe("https://pay.me/seb");
    expect(link?.carriesAmount).toBe(false);
  });

  it("says nothing for a detail that is not a link at all", () => {
    expect(payoutDeepLink(request({ detail: "ask me" }))).toBeNull();
  });
});

describe("Venmo", () => {
  const venmo = { method: "venmo", detail: "@Seb-Trosset" };

  it("names the person, the intent and the note", () => {
    const href = payoutDeepLink(
      request({ ...venmo, currency: "USD", note: "Morocco 2026" }),
    )?.href;

    expect(href).toContain("https://venmo.com/Seb-Trosset");
    expect(href).toContain("txn=pay");
    expect(href).toContain("amount=83.34");
    expect(href).toContain("note=Morocco+2026");
  });

  it("leaves the amount off anything that is not dollars", () => {
    // Venmo's field has no currency beside it. 83.34 in a euro debt would open
    // a payment for eighty-three dollars.
    const link = payoutDeepLink(request({ ...venmo, currency: "EUR" }));

    expect(link?.href).not.toContain("amount");
    expect(link?.carriesAmount).toBe(false);
    // Still worth opening: it lands on the right person.
    expect(link?.href).toContain("venmo.com/Seb-Trosset");
  });

  it("refuses a handle that could bend the URL somewhere else", () => {
    expect(
      payoutDeepLink(request({ ...venmo, detail: "seb/../someone-else" })),
    ).toBeNull();
  });
});

describe("Cash App", () => {
  const cash = { method: "cash_app", detail: "$sebtr" };

  it("puts the amount in the path, in dollars", () => {
    expect(payoutDeepLink(request({ ...cash, currency: "USD" }))?.href).toBe(
      "https://cash.app/$sebtr/83.34",
    );
  });

  it("stops at the cashtag in any other currency", () => {
    const link = payoutDeepLink(request({ ...cash, currency: "CHF" }));

    expect(link?.href).toBe("https://cash.app/$sebtr");
    expect(link?.carriesAmount).toBe(false);
  });
});

describe("UPI", () => {
  const upi = { method: "upi", detail: "seb@okhdfcbank" };

  it("writes the intent the whole of India registers", () => {
    const link = payoutDeepLink(
      request({ ...upi, currency: "INR", minorUnits: "750000" }),
    );

    expect(link?.href).toContain("upi://pay?");
    expect(link?.href).toContain("pa=seb%40okhdfcbank");
    expect(link?.href).toContain("am=7500.00");
    expect(link?.href).toContain("cu=INR");
  });

  it("is a scheme, so the caller knows it answers only on a phone", () => {
    expect(payoutDeepLink(request({ ...upi, currency: "INR" }))?.kind).toBe(
      "scheme",
    );
  });

  it("leaves the amount off anything that is not rupees", () => {
    expect(
      payoutDeepLink(request({ ...upi, currency: "EUR" }))?.href,
    ).not.toContain("am=");
  });

  it("refuses anything that is not a virtual payment address", () => {
    expect(
      payoutDeepLink(request({ ...upi, detail: "9876543210" })),
    ).toBeNull();
  });
});

describe("the profile-only links", () => {
  it("opens Revolut on the Revtag, without the @", () => {
    const link = payoutDeepLink(
      request({ method: "revolut", detail: "@sebtr" }),
    );

    expect(link?.href).toBe("https://revolut.me/sebtr");
    expect(link?.carriesAmount).toBe(false);
  });

  it("opens Monzo on the username", () => {
    expect(
      payoutDeepLink(request({ method: "monzo", detail: "sebtr" }))?.href,
    ).toBe("https://monzo.me/sebtr");
  });
});

/**
 * What has no link, and why that is the answer rather than a gap.
 *
 * Each of these was looked up. TWINT and Swish mint links against a merchant
 * registration; Lydia, Vipps, MobilePay, Satispay and Payconiq are generated
 * at the receiving end; Zelle, Bizum, BLIK, PayID, Interac and Pix happen
 * inside the payer's own banking app. None can be built from what a person
 * hands a friend.
 */
describe("the ones that publish nothing a payer can build", () => {
  const NONE = [
    "twint",
    "swish",
    "lydia",
    "vipps",
    "mobilepay",
    "satispay",
    "payconiq",
    "zelle",
    "bizum",
    "blik",
    "payid",
    "interac",
    "pix",
    "wero",
    "tikkie",
    "wise",
    "bank",
    "cash",
    "cheque",
    "n26",
  ];

  it.each(NONE)("offers nothing for %s", (method) => {
    expect(
      payoutDeepLink(request({ method, detail: "+41791234567" })),
    ).toBeNull();
  });

  it("answers null for a method nobody here has heard of", () => {
    expect(payoutDeepLink(request({ method: "gold-bars" }))).toBeNull();
  });

  it("answers null for every method rather than throwing on any", () => {
    // The catalogue grows without this file being touched, and a new code must
    // cost a missing button rather than a broken screen.
    for (const method of PAYMENT_METHOD_IDS) {
      expect(() =>
        payoutDeepLink(request({ method, detail: "whatever" })),
      ).not.toThrow();
    }
  });
});

describe("an empty detail", () => {
  it("gets no link, on a method that otherwise would", () => {
    expect(
      payoutDeepLink(request({ method: "revolut", detail: "  " })),
    ).toBeNull();
  });
});
