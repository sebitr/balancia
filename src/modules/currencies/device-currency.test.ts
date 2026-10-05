import { describe, expect, it } from "vitest";

import {
  CURRENCY_BY_ZONE,
  currencyOfTimezone,
  ZONES_BY_CURRENCY,
} from "./device-currency";
import { isSupportedCurrency } from "./iso-4217";
import { isSupportedTimezone } from "@/lib/timezones";

/**
 * A new group's currency is permanent, so the guess made for an account that
 * has stated no preference has to be a good one. These hold the table to the
 * two things a guess cannot get wrong — it must name a real place and a
 * currency the app can keep — and to the places people actually open it from.
 */

describe("currencyOfTimezone", () => {
  it("answers with what the place pays in", () => {
    expect(currencyOfTimezone("Europe/Zurich")).toBe("CHF");
    expect(currencyOfTimezone("Europe/Paris")).toBe("EUR");
    expect(currencyOfTimezone("Europe/Berlin")).toBe("EUR");
    expect(currencyOfTimezone("Europe/London")).toBe("GBP");
    expect(currencyOfTimezone("America/New_York")).toBe("USD");
    expect(currencyOfTimezone("America/Los_Angeles")).toBe("USD");
    expect(currencyOfTimezone("America/Toronto")).toBe("CAD");
    expect(currencyOfTimezone("America/Mexico_City")).toBe("MXN");
    expect(currencyOfTimezone("America/Sao_Paulo")).toBe("BRL");
    expect(currencyOfTimezone("Asia/Tokyo")).toBe("JPY");
    expect(currencyOfTimezone("Asia/Singapore")).toBe("SGD");
    expect(currencyOfTimezone("Australia/Sydney")).toBe("AUD");
    expect(currencyOfTimezone("Pacific/Auckland")).toBe("NZD");
    expect(currencyOfTimezone("Africa/Dakar")).toBe("XOF");
    expect(currencyOfTimezone("Pacific/Tahiti")).toBe("XPF");
  });

  it("sends the overseas departments to the euro, not to a franc", () => {
    expect(currencyOfTimezone("Indian/Reunion")).toBe("EUR");
    expect(currencyOfTimezone("America/Martinique")).toBe("EUR");
  });

  it("knows a renamed zone by either of its names", () => {
    // Engines disagree over which spelling is canonical, so a phone can report
    // either. Both have to land on the same currency.
    expect(currencyOfTimezone("Asia/Kolkata")).toBe("INR");
    expect(currencyOfTimezone("Asia/Calcutta")).toBe("INR");
    expect(currencyOfTimezone("Europe/Kyiv")).toBe("UAH");
    expect(currencyOfTimezone("Europe/Kiev")).toBe("UAH");
    expect(currencyOfTimezone("Asia/Ho_Chi_Minh")).toBe("VND");
    expect(currencyOfTimezone("Asia/Saigon")).toBe("VND");
  });

  it("follows a link the table does not list to the zone it points at", () => {
    expect(currencyOfTimezone("America/Montreal")).toBe("CAD");
    expect(currencyOfTimezone("US/Eastern")).toBe("USD");
  });

  it("has no answer where nobody lives, or nothing was detected", () => {
    expect(currencyOfTimezone("UTC")).toBeNull();
    expect(currencyOfTimezone("Etc/GMT+2")).toBeNull();
    expect(currencyOfTimezone("Antarctica/Troll")).toBeNull();
    expect(currencyOfTimezone("Mars/Olympus_Mons")).toBeNull();
    expect(currencyOfTimezone(null)).toBeNull();
    expect(currencyOfTimezone(undefined)).toBeNull();
    expect(currencyOfTimezone("")).toBeNull();
  });

  it("only ever names a currency the app supports", () => {
    const unsupported = [...new Set(CURRENCY_BY_ZONE.values())].filter(
      (currency) => !isSupportedCurrency(currency),
    );
    expect(unsupported).toEqual([]);
  });

  it("gives each zone one currency", () => {
    // Turned round into a map, a zone listed twice keeps whichever row came
    // last — a silent answer to a question nobody meant to ask.
    const listed = Object.values(ZONES_BY_CURRENCY).flat();
    const twice = listed.filter(
      (zone, index) => listed.indexOf(zone) !== index,
    );
    expect(twice).toEqual([]);
  });

  it("only lists zones the runtime accepts", () => {
    // A typo in a key is a zone that silently never matches.
    const unknown = [...CURRENCY_BY_ZONE.keys()].filter(
      (zone) => !isSupportedTimezone(zone),
    );
    expect(unknown).toEqual([]);
  });

  /**
   * Every inhabited zone the runtime can report has a row, so nobody falls
   * through to the euro because the table forgot their city. If a runtime
   * upgrade brings a new zone, this names it: give it the currency of the
   * country it is in.
   */
  it("has a currency for every inhabited zone the runtime knows", () => {
    // Left to the fallback on purpose: a disputed territory, where the table
    // would be taking a side rather than making a guess.
    const UNGUESSED = new Set(["Europe/Simferopol"]);

    const missing = Intl.supportedValuesOf("timeZone").filter(
      (zone) =>
        !zone.startsWith("Antarctica/") &&
        !UNGUESSED.has(zone) &&
        currencyOfTimezone(zone) === null,
    );
    expect(missing).toEqual([]);
  });
});
