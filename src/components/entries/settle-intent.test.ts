import { describe, expect, it } from "vitest";
import { settleIntentOf, settleIntentPath } from "./settle-intent";

/**
 * The link the settle screens write and the route that reads it are two halves
 * of one contract, and the only thing holding them together is these four
 * names. What matters here is that a half-written or hand-edited query never
 * becomes a half-filled form.
 */

describe("writing the link", () => {
  it("names both people and the currency the debt is in", () => {
    expect(
      settleIntentPath("g1", {
        fromParticipantId: "seb",
        toParticipantId: "amelie",
        currency: "EUR",
      }),
    ).toBe(
      "/groups/g1/expenses/new?settleFrom=seb&settleTo=amelie&settleIn=EUR",
    );
  });

  it("round-trips through the reader", () => {
    const intent = {
      fromParticipantId: "ravi",
      toParticipantId: "seb",
      currency: "CHF",
      method: "twint",
    };
    const query = settleIntentPath("g1", intent).split("?")[1];

    expect(settleIntentOf(new URLSearchParams(query))).toEqual(intent);
  });

  it("leaves the method off when the screen had none to name", () => {
    // Every screen but settle-up links here without one, and their links
    // should read exactly as they did before the parameter existed.
    expect(
      settleIntentPath("g1", {
        fromParticipantId: "seb",
        toParticipantId: "amelie",
        currency: "EUR",
        method: null,
      }),
    ).not.toContain("settleVia");
  });
});

describe("reading the query", () => {
  it("reads the record a Server Component is handed", () => {
    expect(
      settleIntentOf({
        settleFrom: "seb",
        settleTo: "amelie",
        settleIn: "EUR",
      }),
    ).toEqual({
      fromParticipantId: "seb",
      toParticipantId: "amelie",
      currency: "EUR",
      method: null,
    });
  });

  it("says nothing when the drawer was opened plain", () => {
    expect(settleIntentOf({})).toBeNull();
    expect(settleIntentOf(new URLSearchParams())).toBeNull();
  });

  it("refuses two thirds of a debt", () => {
    expect(
      settleIntentOf({ settleFrom: "seb", settleTo: "amelie" }),
    ).toBeNull();
    expect(settleIntentOf({ settleFrom: "seb", settleIn: "EUR" })).toBeNull();
    expect(settleIntentOf({ settleTo: "amelie", settleIn: "EUR" })).toBeNull();
  });

  it("refuses a repayment to oneself", () => {
    expect(
      settleIntentOf({ settleFrom: "seb", settleTo: "seb", settleIn: "EUR" }),
    ).toBeNull();
  });

  it("refuses a repeated name rather than picking one of the two", () => {
    expect(
      settleIntentOf({
        settleFrom: ["seb", "ravi"],
        settleTo: "amelie",
        settleIn: "EUR",
      }),
    ).toBeNull();
  });

  it("ignores the list filters travelling on the same query", () => {
    expect(
      settleIntentOf({
        cat: "lodging",
        q: "hotel",
        settleFrom: "seb",
        settleTo: "amelie",
        settleIn: "EUR",
      }),
    ).toEqual({
      fromParticipantId: "seb",
      toParticipantId: "amelie",
      currency: "EUR",
      method: null,
    });
  });

  /**
   * The method is words that get stored, so what arrives here has to be a code
   * the app can translate. Anything else is dropped rather than passed on:
   * `?settleVia=<whatever>` must not be a way to write a settlement that says
   * it was paid by whatever somebody typed into the address bar.
   */
  it("takes a method the vocabulary knows", () => {
    expect(
      settleIntentOf({
        settleFrom: "seb",
        settleTo: "amelie",
        settleIn: "EUR",
        settleVia: "twint",
      })?.method,
    ).toBe("twint");
  });

  it("drops one it does not, rather than passing it through", () => {
    expect(
      settleIntentOf({
        settleFrom: "seb",
        settleTo: "amelie",
        settleIn: "EUR",
        settleVia: "Pay me in gold",
      })?.method,
    ).toBeNull();
  });

  it("keeps the debt when only the method is nonsense", () => {
    // Two named people and a currency are still a debt worth opening the form
    // on; the method is the one part of this link that is optional.
    expect(
      settleIntentOf({
        settleFrom: "seb",
        settleTo: "amelie",
        settleIn: "EUR",
        settleVia: "nonsense",
      }),
    ).not.toBeNull();
  });
});
