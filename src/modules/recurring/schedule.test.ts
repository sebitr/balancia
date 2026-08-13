import { describe, expect, it } from "vitest";
import {
  RecurrenceError,
  firstOccurrence,
  nextOccurrence,
  occurrenceInstant,
  occurrencesUpTo,
  todayIn,
  type RecurrenceRule,
} from "./schedule";

const weekly = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: "weekly",
  interval: 1,
  weekday: 1,
  timezone: "Europe/Paris",
  startDate: "2026-01-01",
  ...overrides,
});

const monthly = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: "monthly",
  interval: 1,
  dayOfMonth: 1,
  timezone: "Europe/Paris",
  startDate: "2026-01-01",
  ...overrides,
});

describe("weekly recurrence", () => {
  it("finds the first matching weekday on or after the start", () => {
    // 2026-01-01 is a Thursday; the next Monday is 2026-01-05.
    expect(firstOccurrence(weekly())).toBe("2026-01-05");
  });

  it("uses the start date itself when it already matches", () => {
    expect(firstOccurrence(weekly({ startDate: "2026-01-05" }))).toBe(
      "2026-01-05",
    );
  });

  it("steps one week at a time", () => {
    expect(nextOccurrence(weekly(), "2026-01-05")).toBe("2026-01-12");
    expect(nextOccurrence(weekly(), "2026-01-12")).toBe("2026-01-19");
  });

  it("supports fortnightly through the interval", () => {
    expect(nextOccurrence(weekly({ interval: 2 }), "2026-01-05")).toBe(
      "2026-01-19",
    );
  });

  it("stops at the end date", () => {
    expect(
      nextOccurrence(weekly({ endDate: "2026-01-10" }), "2026-01-05"),
    ).toBeNull();
  });
});

describe("monthly recurrence", () => {
  it("fires on the chosen day each month", () => {
    expect(firstOccurrence(monthly({ dayOfMonth: 15 }))).toBe("2026-01-15");
    expect(nextOccurrence(monthly({ dayOfMonth: 15 }), "2026-01-15")).toBe(
      "2026-02-15",
    );
  });

  it("moves to the next month when the day has already passed", () => {
    expect(
      firstOccurrence(monthly({ dayOfMonth: 5, startDate: "2026-01-20" })),
    ).toBe("2026-02-05");
  });

  it("clamps the 31st to the last day of shorter months", () => {
    const rule = monthly({ dayOfMonth: 31 });
    expect(nextOccurrence(rule, "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence(rule, "2026-03-31")).toBe("2026-04-30");
  });

  it("returns to the 31st after a clamped month rather than drifting", () => {
    // The bug this guards: stepping from the clamped Feb 28 must give Mar 31,
    // not Mar 28.
    const rule = monthly({ dayOfMonth: 31 });
    expect(nextOccurrence(rule, "2026-02-28")).toBe("2026-03-31");
  });

  it("handles a leap year", () => {
    const rule = monthly({ dayOfMonth: 29, startDate: "2028-01-01" });
    expect(nextOccurrence(rule, "2028-01-29")).toBe("2028-02-29");
    const nonLeap = monthly({ dayOfMonth: 29, startDate: "2026-01-01" });
    expect(nextOccurrence(nonLeap, "2026-01-29")).toBe("2026-02-28");
  });

  it("supports a quarterly interval", () => {
    expect(
      nextOccurrence(monthly({ interval: 3, dayOfMonth: 1 }), "2026-01-01"),
    ).toBe("2026-04-01");
  });
});

describe("yearly recurrence", () => {
  const yearly: RecurrenceRule = {
    frequency: "yearly",
    interval: 1,
    monthOfYear: 6,
    dayOfMonth: 15,
    timezone: "Europe/Paris",
    startDate: "2026-01-01",
  };

  it("fires on the chosen month and day", () => {
    expect(firstOccurrence(yearly)).toBe("2026-06-15");
    expect(nextOccurrence(yearly, "2026-06-15")).toBe("2027-06-15");
  });

  it("rolls to next year when the date has passed", () => {
    expect(firstOccurrence({ ...yearly, startDate: "2026-08-01" })).toBe(
      "2027-06-15",
    );
  });
});

describe("occurrencesUpTo", () => {
  it("lists every occurrence in a window", () => {
    expect(occurrencesUpTo(weekly(), "2026-02-01")).toEqual([
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
      "2026-01-26",
    ]);
  });

  it("catches up from the last generated occurrence", () => {
    expect(
      occurrencesUpTo(weekly(), "2026-02-01", { from: "2026-01-12" }),
    ).toEqual(["2026-01-19", "2026-01-26"]);
  });

  it("returns nothing when the schedule has not started", () => {
    expect(
      occurrencesUpTo(weekly({ startDate: "2026-06-01" }), "2026-02-01"),
    ).toEqual([]);
  });

  it("respects the safety cap", () => {
    const result = occurrencesUpTo(weekly(), "2099-01-01", {
      maxOccurrences: 10,
    });
    expect(result).toHaveLength(10);
  });
});

describe("timezone awareness", () => {
  it("resolves an occurrence to midnight in the rule's own timezone", () => {
    // Midnight in Paris on 1 July 2026 is 22:00 UTC on 30 June (CEST, UTC+2).
    expect(occurrenceInstant("2026-07-01", "Europe/Paris").toISOString()).toBe(
      "2026-06-30T22:00:00.000Z",
    );
    // Midnight in Auckland is 12:00 UTC the previous day (NZST, UTC+12).
    expect(
      occurrenceInstant("2026-07-01", "Pacific/Auckland").toISOString(),
    ).toBe("2026-06-30T12:00:00.000Z");
    expect(occurrenceInstant("2026-07-01", "UTC").toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
  });

  it("crosses a daylight-saving boundary without shifting the calendar date", () => {
    // Europe/Paris springs forward on 2026-03-29.
    const rule = monthly({ dayOfMonth: 29, startDate: "2026-03-01" });
    expect(firstOccurrence(rule)).toBe("2026-03-29");
    expect(nextOccurrence(rule, "2026-03-29")).toBe("2026-04-29");
  });

  it("reports today according to the group's timezone", () => {
    // 2026-07-01T23:30Z is already 2 July in Auckland, still 1 July in New York.
    const instant = new Date("2026-07-01T23:30:00.000Z");
    expect(todayIn("Pacific/Auckland", instant)).toBe("2026-07-02");
    expect(todayIn("America/New_York", instant)).toBe("2026-07-01");
  });

  it("rejects an unknown timezone", () => {
    expect(() => firstOccurrence(weekly({ timezone: "Mars/Olympus" }))).toThrow(
      RecurrenceError,
    );
  });
});

describe("validation", () => {
  it("rejects a non-positive interval", () => {
    expect(() => firstOccurrence(weekly({ interval: 0 }))).toThrow(
      RecurrenceError,
    );
  });

  it("rejects an out-of-range weekday or day of month", () => {
    expect(() => firstOccurrence(weekly({ weekday: 8 }))).toThrow(
      RecurrenceError,
    );
    expect(() => firstOccurrence(monthly({ dayOfMonth: 32 }))).toThrow(
      RecurrenceError,
    );
  });
});
