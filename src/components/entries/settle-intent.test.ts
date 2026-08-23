import { describe, expect, it } from "vitest";
import { settleIntentOf, settleIntentPath } from "./settle-intent";

/**
 * The link the settle screens write and the route that reads it are two halves
 * of one contract, and the only thing holding them together is these three
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
    };
    const query = settleIntentPath("g1", intent).split("?")[1];

    expect(settleIntentOf(new URLSearchParams(query))).toEqual(intent);
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
    });
  });
});
