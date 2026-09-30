import { describe, expect, it } from "vitest";
import {
  isAcceptedCalendarDate,
  isCalendarDate,
  isInCalendarRange,
  isStorableDate,
} from "./calendar-date";

/**
 * A date is a day the calendar has, not a string of the right shape.
 *
 * `Date.parse` said yes to every one of the impossible days below — it rolls
 * them over into the next month — and PostgreSQL said no, as a 500.
 */

describe("isCalendarDate", () => {
  it.each([
    "2025-02-30",
    "2025-04-31",
    "2025-13-01",
    "2025-00-10",
    "2025-06-00",
  ])("refuses %s, which the calendar does not have", (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it("accepts a leap day in a leap year, and only then", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2025-02-29")).toBe(false);
    expect(isCalendarDate("2000-02-29")).toBe(true);
    expect(isCalendarDate("1900-02-29")).toBe(false);
  });

  it("refuses anything that is not exactly YYYY-MM-DD", () => {
    for (const value of [
      "",
      "2025-2-3",
      "02/03/2025",
      "2025-02-03T00:00:00Z",
      " 2025-02-03",
      "2025-W06",
      "2025-034",
    ]) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });
});

describe("the years Balancia accepts", () => {
  it("refuses year zero, which PostgreSQL does not have", () => {
    expect(isAcceptedCalendarDate("0000-01-01")).toBe(false);
    expect(isStorableDate("0000-01-01")).toBe(false);
  });

  it("refuses a year that is a slip of the finger", () => {
    expect(isAcceptedCalendarDate("0202-05-01")).toBe(false);
    expect(isAcceptedCalendarDate("3025-05-01")).toBe(false);
    expect(isInCalendarRange("1899-12-31")).toBe(false);
  });

  it("accepts both ends of the range", () => {
    expect(isAcceptedCalendarDate("1900-01-01")).toBe(true);
    expect(isAcceptedCalendarDate("2999-12-31")).toBe(true);
  });

  it("still reads back a stored day from before the range", () => {
    // A list cursor names a row that already exists; refusing it would send
    // the reader back to the top every time they scrolled past that row.
    expect(isStorableDate("1850-03-01")).toBe(true);
    expect(isStorableDate("1850-02-30")).toBe(false);
  });
});
