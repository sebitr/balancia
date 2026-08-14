import { describe, expect, it } from "vitest";
import { describeSplit, type SplitNote } from "./split-notes";

/**
 * The notes are the only part of the split the user reads when it is wrong, so
 * these assert the *direction* of every mismatch as well as its size. A test
 * that only checked "there is a warning" would pass just as happily on a
 * shortfall reported as an overshoot.
 */

const THREE = ["a", "b", "c"];

const note = (over: Partial<Parameters<typeof describeSplit>[0]>) =>
  describeSplit({
    totalMinor: 8460n,
    currency: "CHF",
    method: "equal",
    participantIds: THREE,
    values: {},
    absorberName: "Seb",
    locale: "en-GB",
    ...over,
  });

/** The catalogue key alone, for the cases where the params are not the point. */
const keyOf = (result: SplitNote | null) => result?.key ?? null;

/**
 * The same note with ordinary spaces.
 *
 * `formatMoney` separates a currency from its figure with a non-breaking
 * space, which is right on screen and unreadable in a diff — an expectation
 * that fails here otherwise looks character-for-character identical to what it
 * got.
 */
const plain = (result: SplitNote | null) =>
  result === null
    ? null
    : {
        ...result,
        params: Object.fromEntries(
          Object.entries(result.params ?? {}).map(([key, value]) => [
            key,
            typeof value === "string" ? value.replace(/\s/gu, " ") : value,
          ]),
        ),
      };

describe("describeSplit", () => {
  describe("an empty selection", () => {
    it("is reported however much has been typed", () => {
      expect(keyOf(note({ participantIds: [] }))).toBe("nobody");
      expect(keyOf(note({ participantIds: [], totalMinor: null }))).toBe(
        "nobody",
      );
    });

    it("outranks every other note", () => {
      expect(
        keyOf(note({ participantIds: [], method: "exact", values: {} })),
      ).toBe("nobody");
    });
  });

  it("says nothing before an amount has been typed", () => {
    expect(note({ totalMinor: null })).toBeNull();
  });

  describe("an equal split", () => {
    it("stays quiet when it divides exactly", () => {
      expect(note({ totalMinor: 9000n })).toBeNull();
    });

    /** 84.60 over three is 28.20 each — nothing left over. */
    it("names who absorbs the leftover minor units", () => {
      expect(plain(note({ totalMinor: 8461n }))).toEqual({
        key: "remainderAbsorbed",
        params: { amount: "CHF 0.01", name: "Seb" },
        tone: "info",
      });
    });

    /** Two cents over three people is one cent each to the first two. */
    it("reports the whole remainder, not one unit of it", () => {
      expect(plain(note({ totalMinor: 8462n }))?.params?.amount).toBe(
        "CHF 0.02",
      );
    });

    it("is an explanation rather than a refusal", () => {
      expect(note({ totalMinor: 8461n })?.tone).toBe("info");
    });
  });

  describe("exact amounts", () => {
    const exact = (values: Record<string, string>) =>
      note({ method: "exact", values });

    it("stays quiet when they add up", () => {
      expect(exact({ a: "28.20", b: "28.20", c: "28.20" })).toBeNull();
    });

    it("says how much is still to assign", () => {
      expect(plain(exact({ a: "28.20", b: "28.20", c: "" }))).toEqual({
        key: "stillToAssign",
        params: { amount: "CHF 28.20" },
        tone: "error",
      });
    });

    it("says how much is over the total", () => {
      expect(plain(exact({ a: "40.00", b: "40.00", c: "40.00" }))).toEqual({
        key: "overTheTotal",
        params: { amount: "CHF 35.40" },
        tone: "error",
      });
    });

    /** Mid-typing values are worth nothing yet, not worth NaN. */
    it("treats an unparseable value as nothing assigned", () => {
      expect(keyOf(exact({ a: "28.20", b: "28.20", c: "2." }))).toBe(
        "stillToAssign",
      );
    });

    it("ignores values belonging to people who are not in the split", () => {
      const result = describeSplit({
        totalMinor: 8460n,
        currency: "CHF",
        method: "exact",
        participantIds: ["a", "b"],
        values: { a: "42.30", b: "42.30", c: "99.00" },
        absorberName: "Seb",
        locale: "en-GB",
      });
      expect(result).toBeNull();
    });
  });

  describe("percentages", () => {
    const percent = (values: Record<string, string>) =>
      note({ method: "percentage", values });

    it("stays quiet at exactly 100", () => {
      expect(percent({ a: "34", b: "33", c: "33" })).toBeNull();
    });

    it("reports the sum it actually got", () => {
      expect(percent({ a: "30", b: "30", c: "30" })).toEqual({
        key: "percentagesOff",
        params: { sum: "90" },
        tone: "error",
      });
    });

    /** Decimal, not float: 33.33 × 3 must not arrive as 99.99000000000001. */
    it("adds fractional percentages exactly", () => {
      expect(percent({ a: "33.33", b: "33.33", c: "33.33" })?.params?.sum).toBe(
        "99.99",
      );
    });

    it("takes a comma for the decimal separator", () => {
      expect(percent({ a: "33,5", b: "33", c: "33" })?.params?.sum).toBe(
        "99.5",
      );
    });

    it("counts a blank as zero rather than dropping the person", () => {
      expect(percent({ a: "50", b: "50", c: "" })).toBeNull();
    });
  });

  /** Shares round like everything else, and `previewSplit` already says so. */
  it("leaves the shares remainder to the rounding note", () => {
    expect(note({ method: "shares", values: { a: "1", b: "1", c: "1" } })).toBe(
      null,
    );
  });
});
