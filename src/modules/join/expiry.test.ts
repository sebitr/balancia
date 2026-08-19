import { describe, expect, it } from "vitest";
import {
  DEFAULT_JOIN_LINK_EXPIRY,
  expiryDate,
  isExpiryChoice,
  remainingFor,
} from "./expiry";

/**
 * The arithmetic behind one row of the invite-link card.
 *
 * It is worth its own tests because the row is read as a promise — "this link
 * stops working in six days" — and every rounding decision here is the
 * difference between that promise being kept and being optimistic.
 */

const NOW = new Date("2026-08-19T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("expiryDate", () => {
  it("measures every choice from now", () => {
    expect(expiryDate("day", NOW)?.toISOString()).toBe(
      "2026-08-20T12:00:00.000Z",
    );
    expect(expiryDate("week", NOW)?.toISOString()).toBe(
      "2026-08-26T12:00:00.000Z",
    );
    expect(expiryDate("month", NOW)?.toISOString()).toBe(
      "2026-09-18T12:00:00.000Z",
    );
  });

  it("gives a link that never lapses no date at all", () => {
    expect(expiryDate("never", NOW)).toBeNull();
  });

  it("defaults to the week", () => {
    expect(DEFAULT_JOIN_LINK_EXPIRY).toBe("week");
  });
});

describe("isExpiryChoice", () => {
  it("accepts only the four", () => {
    expect(isExpiryChoice("week")).toBe(true);
    expect(isExpiryChoice("never")).toBe(true);
    expect(isExpiryChoice("fortnight")).toBe(false);
    expect(isExpiryChoice(7)).toBe(false);
    expect(isExpiryChoice(null)).toBe(false);
  });
});

describe("remainingFor", () => {
  it("says never when there is no date", () => {
    expect(remainingFor(null, NOW)).toEqual({ kind: "never" });
  });

  it("says expired on and after the moment itself", () => {
    expect(remainingFor(NOW, NOW)).toEqual({ kind: "expired" });
    expect(remainingFor(new Date(NOW.getTime() - 1), NOW)).toEqual({
      kind: "expired",
    });
  });

  it("counts in hours below two days", () => {
    expect(remainingFor(new Date(NOW.getTime() + 24 * HOUR), NOW)).toEqual({
      kind: "hours",
      count: 24,
    });
    expect(remainingFor(new Date(NOW.getTime() + 47 * HOUR), NOW)).toEqual({
      kind: "hours",
      count: 47,
    });
  });

  it("counts in days from two days up", () => {
    expect(remainingFor(new Date(NOW.getTime() + 7 * DAY), NOW)).toEqual({
      kind: "days",
      count: 7,
    });
  });

  it("rounds up, so a link is never said to be shorter than it is", () => {
    // Ten minutes past six days: still "in 7 days", because the link does in
    // fact outlive the sixth.
    const expiresAt = new Date(NOW.getTime() + 6 * DAY + 10 * 60 * 1000);
    expect(remainingFor(expiresAt, NOW)).toEqual({ kind: "days", count: 7 });

    const soon = new Date(NOW.getTime() + 30 * 60 * 1000);
    expect(remainingFor(soon, NOW)).toEqual({ kind: "hours", count: 1 });
  });
});
