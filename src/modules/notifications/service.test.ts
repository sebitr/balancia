import { describe, expect, it } from "vitest";
import { silences } from "./service";

/**
 * When a quietened group is still quiet.
 *
 * One row in `notification_group_mutes` carries both a mute and a snooze, and
 * `snoozedUntil` is the whole of the difference: null lasts until somebody
 * undoes it, a timestamp lasts until it passes. Suppression happens at write
 * time, so getting this wrong does not hide a notification — it destroys one.
 */
describe("whether a group is silenced", () => {
  const now = new Date("2026-08-24T20:00:00Z");

  it("silences indefinitely when nothing says when it lifts", () => {
    expect(silences({ snoozedUntil: null }, now)).toBe(true);
  });

  it("silences while the snooze still has time on it", () => {
    expect(
      silences({ snoozedUntil: new Date("2026-08-25T18:00:00Z") }, now),
    ).toBe(true);
  });

  /**
   * A spent row is left in the table rather than swept. It stops suppressing
   * the moment its hour comes, so nothing has to run on a schedule to make
   * a group audible again.
   */
  it("stops the moment the snooze runs out", () => {
    expect(
      silences({ snoozedUntil: new Date("2026-08-24T19:59:59Z") }, now),
    ).toBe(false);
  });

  /** The boundary belongs to the past: at the stroke, the group is back. */
  it("is over exactly on the hour it named", () => {
    expect(silences({ snoozedUntil: now }, now)).toBe(false);
  });
});
