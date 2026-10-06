import { describe, expect, it } from "vitest";
import { describeSplit, type SplitNote } from "./split-notes";

/**
 * The notes are the only part of the split the user reads when it is wrong, so
 * these assert the *direction* of every mismatch as well as its size. A test
 * that only checked "there is a warning" would pass just as happily on a
 * shortfall reported as an overshoot.
 */

const THREE = ["a", "b", "c"];
const NAMES: Record<string, string> = { a: "Seb", b: "Hervé", c: "Cyril" };

const note = (over: Partial<Parameters<typeof describeSplit>[0]>) =>
  describeSplit({
    totalMinor: 8460n,
    currency: "CHF",
    method: "equal",
    participantIds: THREE,
    values: {},
    nameOf: (id) => NAMES[id] ?? "",
    locale: "en-GB",
    language: "en",
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

    /** Mid-typing: "2." is somebody on the way to "2.50", who means 2 so far. */
    it("reads a trailing point as the number before it", () => {
      expect(plain(exact({ a: "28.20", b: "28.20", c: "2." }))).toEqual({
        key: "stillToAssign",
        params: { amount: "CHF 26.20" },
        tone: "error",
      });
    });

    /**
     * An empty field is nothing assigned, to the note and to the save alike.
     * The preview used to refuse it as a missing value while the note said the
     * amounts added up, so the sheet looked right and the save said no.
     */
    it("accepts one person carrying it all, the others left empty", () => {
      expect(exact({ a: "84.60", b: "", c: "" })).toBeNull();
    });

    it("takes a comma for the decimal separator", () => {
      expect(exact({ a: "28,20", b: "28,20", c: "28,20" })).toBeNull();
    });

    it("says so when a field holds something that is not a number", () => {
      expect(exact({ a: "28.20", b: "28.20", c: "lots" })).toEqual({
        key: "unreadable",
        tone: "error",
      });
    });

    it("ignores values belonging to people who are not in the split", () => {
      expect(
        note({
          method: "exact",
          participantIds: ["a", "b"],
          values: { a: "42.30", b: "42.30", c: "99.00" },
        }),
      ).toBeNull();
    });
  });

  describe("percentages", () => {
    const percent = (values: Record<string, string>, totalMinor = 8460n) =>
      note({ method: "percentage", values, totalMinor });

    it("stays quiet at exactly 100 when nobody's figure shows it", () => {
      expect(percent({ a: "34", b: "33", c: "33" }, 10000n)).toBeNull();
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

    /**
     * The preview refused "33,5" while this note added it up, so a French
     * keyboard could write a split the sheet called fine and the save turned
     * down.
     */
    it("takes a comma for the decimal separator", () => {
      expect(percent({ a: "33,5", b: "33", c: "33" })?.params?.sum).toBe(
        "99.5",
      );
      expect(percent({ a: "33,5", b: "33,5", c: "33" }, 10000n)).toBeNull();
    });

    it("counts a blank as zero rather than dropping the person", () => {
      expect(percent({ a: "50", b: "50", c: "" }, 10000n)).toBeNull();
    });
  });

  describe("shares", () => {
    it("says so when nobody has a share", () => {
      expect(
        note({ method: "shares", values: { a: "0", b: "0", c: "" } }),
      ).toEqual({ key: "sharesAllZero", tone: "error" });
    });

    it("stays quiet when the shares divide exactly", () => {
      expect(
        note({ method: "shares", values: { a: "2", b: "1", c: "1" } }),
      ).toBeNull();
    });
  });

  /**
   * A rounding note is only worth its line when the moved cent shows: two
   * people who asked for the same thing pay different amounts. Anything else
   * is the arithmetic talking to itself.
   */
  describe("rounding", () => {
    /**
     * The audit's case: €90 at 33.34 / 33.33 / 33.33 is three people paying
     * €30.00 each, and the sheet used to tell them two of them paid €0.02
     * more.
     */
    it("says nothing when every figure on screen is the same", () => {
      expect(
        note({
          totalMinor: 9000n,
          currency: "EUR",
          method: "percentage",
          values: { a: "33.34", b: "33.33", c: "33.33" },
        }),
      ).toBeNull();
    });

    it("says nothing when an equal split divides exactly", () => {
      expect(note({ totalMinor: 9000n })).toBeNull();
    });

    /** 84.61 three ways is 28.21 for the first and 28.20 for the others. */
    it("names who pays the extra cent on an equal split", () => {
      expect(plain(note({ totalMinor: 8461n }))).toEqual({
        key: "roundedUp",
        params: {
          you: "no",
          count: 1,
          names: "Seb",
          amount: "CHF 0.01",
          total: "CHF 84.61",
        },
        tone: "info",
      });
    });

    /** Two cents over three people is one cent each to the first two. */
    it("names everybody who pays it, and says each pays one cent", () => {
      const result = plain(note({ totalMinor: 8462n }));
      expect(result?.params).toMatchObject({
        names: "Seb and Hervé",
        count: 2,
        amount: "CHF 0.01",
      });
    });

    it("joins the names in the reader's language", () => {
      expect(note({ totalMinor: 8462n, language: "fr" })?.params?.names).toBe(
        "Seb et Hervé",
      );
    });

    it("calls the reader you rather than by name", () => {
      expect(note({ totalMinor: 8461n, selfId: "a" })?.params).toMatchObject({
        you: "yes",
        count: 0,
        names: "",
      });
      expect(note({ totalMinor: 8462n, selfId: "b" })?.params).toMatchObject({
        you: "yes",
        count: 1,
        names: "Seb",
      });
    });

    it("holds shares to the same rule", () => {
      // Equal shares behave as an equal split, cent and all.
      expect(
        note({
          totalMinor: 8461n,
          method: "shares",
          values: { a: "1", b: "1", c: "1" },
        })?.params?.names,
      ).toBe("Seb");
      // Different shares explain different amounts: €10 as 1 and 2 shares is
      // €3.33 and €6.67, and nobody is told about the cent inside it.
      expect(
        note({
          totalMinor: 1000n,
          method: "shares",
          participantIds: ["a", "b"],
          values: { a: "1", b: "2" },
        }),
      ).toBeNull();
    });

    it("compares only people who asked for the same thing", () => {
      // 2/1/1 shares of 100.01: Hervé and Cyril both get 25.00, so the cent
      // inside Seb's 50.01 is not visible beside anybody's equal figure.
      expect(
        note({
          totalMinor: 10001n,
          method: "shares",
          values: { a: "2", b: "1", c: "1" },
        }),
      ).toBeNull();
      // 1/1/2 of 0.06: the two single shares come to 0.02 and 0.01.
      expect(
        note({
          totalMinor: 6n,
          method: "shares",
          values: { a: "1", b: "1", c: "2" },
        })?.params?.names,
      ).toBe("Seb");
    });

    it("has nothing to say about exact amounts, which are typed whole", () => {
      expect(
        note({
          totalMinor: 10000n,
          method: "exact",
          values: { a: "33.34", b: "33.33", c: "33.33" },
        }),
      ).toBeNull();
    });
  });
});
