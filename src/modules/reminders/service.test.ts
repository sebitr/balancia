import { describe, expect, it } from "vitest";
import { isLocked } from "./service";
import { REMIND_LOCK_HOURS } from "./types";

const NOW = new Date("2026-08-14T12:00:00Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

/**
 * The limit exists so that being owed money cannot become a way to pester
 * somebody. It is enforced in the service rather than in the sheet, because a
 * screen can be bypassed and this cannot.
 */
describe("the once-a-day limit", () => {
  it("leaves someone who has never been reminded open to it", () => {
    expect(isLocked(null, NOW)).toBe(false);
  });

  it("holds for a full day after a reminder", () => {
    expect(isLocked(hoursAgo(0), NOW)).toBe(true);
    expect(isLocked(hoursAgo(1), NOW)).toBe(true);
    expect(isLocked(hoursAgo(REMIND_LOCK_HOURS - 0.5), NOW)).toBe(true);
  });

  it("lifts once the day is up", () => {
    expect(isLocked(hoursAgo(REMIND_LOCK_HOURS), NOW)).toBe(false);
    expect(isLocked(hoursAgo(REMIND_LOCK_HOURS + 1), NOW)).toBe(false);
  });

  it("does not lock on a timestamp from the future", () => {
    // Clock skew between app servers should not extend a limit indefinitely,
    // but it must not be a way around one either: a future stamp still counts
    // as recent, which is the safe direction to be wrong in.
    expect(isLocked(new Date(NOW.getTime() + 60_000), NOW)).toBe(true);
  });
});
