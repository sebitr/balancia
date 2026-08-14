import { describe, expect, it } from "vitest";
import {
  DEFAULT_METHODS,
  METHODS_BY_COUNTRY,
  PAYMENT_METHODS,
  PAYMENT_METHOD_IDS,
  ROW_METHOD_COUNT,
  countryForTimezone,
  findPaymentMethod,
  methodsForCountry,
  searchPaymentMethods,
} from "./payment-methods";

/** Stands in for the translated labels the UI passes in. */
const label = (id: string): string =>
  ({
    bank: "Bank",
    cash: "Cash",
    cash_app: "Cash App",
    interac: "Interac e-Transfer",
    twint: "TWINT",
    paypal: "PayPal",
  })[id] ?? id;

describe("the method list", () => {
  it("has no duplicate codes", () => {
    const ids = PAYMENT_METHODS.map((method) => method.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The union and the list are declared separately — the union is what types
   * the message lookups — so nothing but this stops one gaining a method the
   * other never heard of.
   */
  it("defines every id it declares, and declares every id it defines", () => {
    expect([...PAYMENT_METHODS.map((method) => method.id)].sort()).toEqual(
      [...PAYMENT_METHOD_IDS].sort(),
    );
  });

  it("offers every method a country map points at", () => {
    for (const [country, ids] of Object.entries(METHODS_BY_COUNTRY)) {
      for (const id of ids) {
        expect(findPaymentMethod(id), `${country} → ${id}`).toBeDefined();
      }
    }
  });

  it("keeps a brand colour on every brand tile", () => {
    for (const method of PAYMENT_METHODS) {
      if (method.kind !== "brand") continue;
      expect(method.brandColor, method.id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("methodsForCountry", () => {
  it("leads with the method that country actually uses", () => {
    expect(methodsForCountry("CH")[0]).toBe("twint");
    expect(methodsForCountry("ES")[0]).toBe("bizum");
    expect(methodsForCountry("PL")[0]).toBe("blik");
    expect(methodsForCountry("BR")[0]).toBe("pix");
  });

  /**
   * Paying someone back is not paying a shop. Faster Payments is how it is
   * done in the UK, so plain bank transfer leads there even though it would
   * never lead a list of *retail* payment methods.
   */
  it("leads the UK with bank transfer rather than an app", () => {
    expect(methodsForCountry("GB")[0]).toBe("bank");
  });

  /** Wero reached P2P in exactly these three countries, and nowhere else yet. */
  it("offers Wero only where it launched", () => {
    for (const country of ["FR", "DE", "BE"]) {
      expect(methodsForCountry(country), country).toContain("wero");
    }
    for (const country of ["CH", "NL", "AT", "IT", "GB"]) {
      expect(methodsForCountry(country), country).not.toContain("wero");
    }
  });

  it("gives Belgium its own scheme rather than a generic bank transfer", () => {
    expect(methodsForCountry("BE")[0]).toBe("payconiq");
  });

  /** Zelle *is* the bank transfer in the US; listing both would be one thing twice. */
  it("does not offer Americans a bank transfer beside Zelle", () => {
    const us = methodsForCountry("US");
    expect(us).toContain("zelle");
    expect(us).not.toContain("bank");
  });

  it("accepts a lowercase code", () => {
    expect(methodsForCountry("ch")).toEqual(methodsForCountry("CH"));
  });

  /**
   * Guessing wrong is worse than being dull: an unknown country gets the
   * methods that work everywhere rather than someone else's habits.
   */
  it("falls back for an unknown or missing country", () => {
    expect(methodsForCountry("ZZ")).toEqual(DEFAULT_METHODS);
    expect(methodsForCountry(null)).toEqual(DEFAULT_METHODS);
    expect(methodsForCountry(undefined)).toEqual(DEFAULT_METHODS);
  });

  it("always has enough to fill the row", () => {
    for (const country of [...Object.keys(METHODS_BY_COUNTRY), "ZZ", ""]) {
      expect(methodsForCountry(country).length, country).toBeGreaterThanOrEqual(
        ROW_METHOD_COUNT,
      );
    }
  });

  it("never repeats a method within a country", () => {
    for (const country of Object.keys(METHODS_BY_COUNTRY)) {
      const ids = methodsForCountry(country);
      expect(new Set(ids).size, country).toBe(ids.length);
    }
  });

  /**
   * Cash is universal, and handing over a note must never cost an extra tap —
   * so it belongs in the row itself, not merely somewhere in the list.
   */
  it("keeps cash in the visible row everywhere", () => {
    for (const country of [...Object.keys(METHODS_BY_COUNTRY), "ZZ"]) {
      expect(
        methodsForCountry(country).slice(0, ROW_METHOD_COUNT),
        country,
      ).toContain("cash");
    }
  });
});

describe("countryForTimezone", () => {
  it("reads the country off the group's timezone", () => {
    expect(countryForTimezone("Europe/Zurich")).toBe("CH");
    expect(countryForTimezone("America/New_York")).toBe("US");
  });

  /** The schema default. A group that never chose tells us nothing. */
  it("gives up on UTC rather than guessing", () => {
    expect(countryForTimezone("UTC")).toBeNull();
    expect(countryForTimezone(null)).toBeNull();
    expect(countryForTimezone("Mars/Olympus_Mons")).toBeNull();
  });

  it("feeds methodsForCountry end to end", () => {
    expect(methodsForCountry(countryForTimezone("Europe/Zurich"))[0]).toBe(
      "twint",
    );
    expect(methodsForCountry(countryForTimezone("Europe/Brussels"))[0]).toBe(
      "payconiq",
    );
    expect(methodsForCountry(countryForTimezone("UTC"))).toEqual(
      DEFAULT_METHODS,
    );
  });
});

describe("searchPaymentMethods", () => {
  it("returns everything for an empty query", () => {
    expect(searchPaymentMethods("", label)).toHaveLength(
      PAYMENT_METHODS.length,
    );
  });

  it("finds a brand by name", () => {
    expect(searchPaymentMethods("twint", label).map((m) => m.id)).toContain(
      "twint",
    );
  });

  /**
   * The whole point of folding Virement and Überweisung into one method: a
   * French speaker types what they say and still finds the bank transfer.
   */
  it("finds the bank transfer under its regional names", () => {
    for (const term of ["virement", "überweisung", "uberweisung", "sepa"]) {
      expect(
        searchPaymentMethods(term, label).map((m) => m.id),
        term,
      ).toContain("bank");
    }
  });

  it("ignores accents", () => {
    expect(searchPaymentMethods("especes", label).map((m) => m.id)).toContain(
      "cash",
    );
  });

  it("puts a prefix match above a match in the middle", () => {
    // "pay" starts PayPal and PayID, but only trails Apple Pay and Google Pay.
    const ids = searchPaymentMethods("pay", label).map((m) => m.id);
    expect(ids).toContain("apple_pay");
    expect(ids.indexOf("paypal")).toBeLessThan(ids.indexOf("apple_pay"));
    expect(ids.indexOf("payid")).toBeLessThan(ids.indexOf("google_pay"));
  });

  it("returns nothing when nothing matches", () => {
    expect(searchPaymentMethods("zzzznope", label)).toHaveLength(0);
  });
});
