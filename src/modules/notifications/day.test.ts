import { describe, expect, it } from "vitest";
import { daySectionOf } from "./day";

/**
 * Which heading a row sits under.
 *
 * The reader's zone decides, not the server's: a Sydney evening and a Paris
 * afternoon are the same instant and different days, and the heading has to
 * agree with the clock on the wall beside the phone.
 */
describe("placing an instant under a day heading", () => {
  // 20:30 in Paris on the 24th, and already half past four on the 25th in
  // Sydney — which is the disagreement the last case below is about.
  const now = new Date("2026-08-24T18:30:00Z");

  it("calls this morning today", () => {
    expect(
      daySectionOf(new Date("2026-08-24T07:00:00Z"), now, "Europe/Paris"),
    ).toBe("today");
  });

  it("calls the previous calendar day yesterday", () => {
    expect(
      daySectionOf(new Date("2026-08-23T18:00:00Z"), now, "Europe/Paris"),
    ).toBe("yesterday");
  });

  it("sends anything older to earlier", () => {
    expect(
      daySectionOf(new Date("2026-08-20T18:00:00Z"), now, "Europe/Paris"),
    ).toBe("earlier");
  });

  /**
   * The same instant is the 24th in Paris and the 25th in Sydney, so a row
   * that is "today" for one reader is "yesterday" for the other.
   */
  it("reads the calendar in the reader's zone, not the server's", () => {
    const instant = new Date("2026-08-24T07:00:00Z");

    expect(daySectionOf(instant, now, "Europe/Paris")).toBe("today");
    expect(daySectionOf(instant, now, "Australia/Sydney")).toBe("yesterday");
  });

  /**
   * The night the clocks go back has a twenty-five hour day. Stepping back by
   * a fixed twenty-four hours would land inside the same date and lose the
   * heading altogether.
   */
  it("steps a calendar day rather than twenty-four hours", () => {
    // 26 October 2026, the morning after Europe's clocks went back.
    const morning = new Date("2026-10-26T08:00:00Z");

    expect(
      daySectionOf(new Date("2026-10-25T10:00:00Z"), morning, "Europe/Paris"),
    ).toBe("yesterday");
  });
});
