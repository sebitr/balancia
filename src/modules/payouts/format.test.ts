import { describe, expect, it } from "vitest";
import {
  displayPayoutDetail,
  displayPayoutEntries,
  formatPhoneAsTyped,
} from "./format";

/**
 * The spacing, which is the whole difference between a number somebody can
 * check and thirteen digits in a row.
 *
 * What is stored is `+41791234567`, and none of this changes that:
 * `normalizePayoutDetail` strips every space on the way in, so a field that
 * regroups as it is typed changes what is read and nothing else.
 */

describe("formatPhoneAsTyped", () => {
  it("groups an international number the way its own country does", () => {
    expect(formatPhoneAsTyped("+41791234567", null)).toBe("+41 79 123 45 67");
    expect(formatPhoneAsTyped("+393123456789", null)).toBe("+39 312 345 6789");
    expect(formatPhoneAsTyped("+48512345678", null)).toBe("+48 512 345 678");
  });

  it("groups a number typed the local way, using the method's country", () => {
    // Half of Switzerland writes its own number as 079 …, and a field that
    // only groups numbers carrying a country code leaves them out.
    expect(formatPhoneAsTyped("0791234567", "CH")).toBe("079 123 45 67");
    expect(formatPhoneAsTyped("3123456789", "IT")).toBe("312 345 6789");
  });

  it("lets a country code win over the country it was handed", () => {
    // Somebody Italian being paid by a French friend's Lydia.
    expect(formatPhoneAsTyped("+393123456789", "FR")).toBe("+39 312 345 6789");
  });

  it("waits for a digit, so a plus survives being typed", () => {
    expect(formatPhoneAsTyped("+", "CH")).toBe("+");
    expect(formatPhoneAsTyped("", "CH")).toBe("");
    expect(formatPhoneAsTyped("  ", "CH")).toBe("  ");
  });

  it("keeps every digit of a number longer than its plan", () => {
    // A number we have not heard of is still somebody's number, and losing a
    // digit while they type is the one thing this must never do.
    const long = "+4179123456789012";
    expect(formatPhoneAsTyped(long, "CH").replace(/\D/g, "")).toBe(
      long.replace(/\D/g, ""),
    );
  });
});

describe("displayPayoutDetail", () => {
  it("puts the spacing back on a stored number", () => {
    expect(displayPayoutDetail("twint", "+41791234567")).toBe(
      "+41 79 123 45 67",
    );
    expect(displayPayoutDetail("satispay", "+393123456789")).toBe(
      "+39 312 345 6789",
    );
  });

  it("leaves everything that is not a number exactly as it was stored", () => {
    // An IBAN is kept in the groups of four it was typed in, and a handle is
    // its owner's business down to the capitals.
    expect(displayPayoutDetail("bank", "CH9300762011623852957")).toBe(
      "CH9300762011623852957",
    );
    expect(displayPayoutDetail("revolut", "@Sebastien")).toBe("@Sebastien");
    expect(displayPayoutDetail("cash", "")).toBe("");
  });

  it("hands back a half-written number rather than editing it", () => {
    expect(displayPayoutDetail("twint", "0791234567")).toBe("0791234567");
  });
});

describe("displayPayoutEntries", () => {
  it("spaces the numbers on a saved list and touches nothing else", () => {
    expect(
      displayPayoutEntries([
        { method: "twint", detail: "+41791234567" },
        { method: "bank", detail: "CH9300762011623852957" },
      ]),
    ).toEqual([
      { method: "twint", detail: "+41 79 123 45 67" },
      { method: "bank", detail: "CH9300762011623852957" },
    ]);
  });
});
