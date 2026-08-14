import { describe, expect, it } from "vitest";
import { CornerTracker, TRACKER_DEFAULTS } from "./tracking";
import type { DocumentCorners } from "./geometry";

/** A page in normalized coordinates, roughly centred. */
const page: DocumentCorners = {
  topLeft: { x: 0.15, y: 0.1 },
  topRight: { x: 0.85, y: 0.1 },
  bottomRight: { x: 0.85, y: 0.9 },
  bottomLeft: { x: 0.15, y: 0.9 },
};

function shifted(corners: DocumentCorners, dx: number): DocumentCorners {
  return {
    topLeft: { x: corners.topLeft.x + dx, y: corners.topLeft.y },
    topRight: { x: corners.topRight.x + dx, y: corners.topRight.y },
    bottomRight: { x: corners.bottomRight.x + dx, y: corners.bottomRight.y },
    bottomLeft: { x: corners.bottomLeft.x + dx, y: corners.bottomLeft.y },
  };
}

/** Feeds the same corners at a steady detection cadence. */
function holdStill(
  tracker: CornerTracker,
  corners: DocumentCorners,
  fromMs: number,
  untilMs: number,
  stepMs = 140,
) {
  let state = tracker.update(corners, fromMs);
  for (let now = fromMs + stepMs; now <= untilMs; now += stepMs) {
    state = tracker.update(corners, now);
  }
  return state;
}

describe("CornerTracker", () => {
  it("searches until something credible appears", () => {
    const tracker = new CornerTracker();
    expect(tracker.update(null, 0)).toEqual({
      corners: null,
      status: "searching",
    });
  });

  it("reports a held page ready after the hold time", () => {
    const tracker = new CornerTracker();
    const state = holdStill(tracker, page, 0, TRACKER_DEFAULTS.holdMs + 300);
    expect(state.status).toBe("ready");
    expect(state.corners).not.toBeNull();
  });

  it("does not become ready while the page keeps moving", () => {
    const tracker = new CornerTracker();
    let state = tracker.update(page, 0);
    // Drifting a couple of percent of the frame per detection is well above
    // any hand-shake tolerance.
    for (let step = 1; step <= 20; step += 1) {
      state = tracker.update(shifted(page, step * 0.02), step * 140);
    }
    expect(state.status).toBe("detected");
  });

  it("restarts the hold when movement interrupts it", () => {
    const tracker = new CornerTracker();
    holdStill(tracker, page, 0, 400);
    // A shove, then stillness again: readiness must count from the shove.
    tracker.update(shifted(page, 0.1), 540);
    const soonAfter = holdStill(tracker, shifted(page, 0.1), 680, 900);
    expect(soonAfter.status).not.toBe("ready");
    // Held long past the smoothing's settling tail plus the hold time, it
    // does become ready again.
    const later = holdStill(
      tracker,
      shifted(page, 0.1),
      1040,
      1040 + TRACKER_DEFAULTS.holdMs + 1200,
    );
    expect(later.status).toBe("ready");
  });

  it("snaps to a contour that appears somewhere else entirely", () => {
    const tracker = new CornerTracker();
    tracker.update(page, 0);
    const elsewhere = shifted(page, 0.4);
    const state = tracker.update(elsewhere, 140);
    // No easing across the screen: the outline is immediately at the new
    // contour, and the hold starts over.
    expect(state.corners).toEqual(elsewhere);
    expect(state.status).toBe("detected");
  });

  it("smooths small movements instead of following them raw", () => {
    const tracker = new CornerTracker({ alpha: 0.3 });
    tracker.update(page, 0);
    const nudged = shifted(page, 0.01);
    const state = tracker.update(nudged, 140);
    const x = state.corners?.topLeft.x ?? 0;
    expect(x).toBeGreaterThan(page.topLeft.x);
    expect(x).toBeLessThan(nudged.topLeft.x);
  });

  it("forgives a single missed detection without dropping the outline", () => {
    const tracker = new CornerTracker();
    holdStill(tracker, page, 0, 400);
    const state = tracker.update(null, 540);
    expect(state.corners).not.toBeNull();
    expect(state.status).toBe("detected");
  });

  it("resets once the contour stays gone", () => {
    const tracker = new CornerTracker();
    holdStill(tracker, page, 0, 400);
    let state = tracker.update(null, 540);
    for (let miss = 0; miss <= TRACKER_DEFAULTS.maxMisses; miss += 1) {
      state = tracker.update(null, 680 + miss * 140);
    }
    expect(state).toEqual({ corners: null, status: "searching" });
  });

  it("a missed frame interrupts the hold", () => {
    const tracker = new CornerTracker();
    holdStill(tracker, page, 0, TRACKER_DEFAULTS.holdMs - 100);
    tracker.update(null, TRACKER_DEFAULTS.holdMs);
    // Back, and still — but the clock restarted at the miss.
    const state = holdStill(
      tracker,
      page,
      TRACKER_DEFAULTS.holdMs + 140,
      TRACKER_DEFAULTS.holdMs + 400,
    );
    expect(state.status).not.toBe("ready");
  });

  it("reset returns it to searching", () => {
    const tracker = new CornerTracker();
    holdStill(tracker, page, 0, 800);
    tracker.reset();
    expect(tracker.update(null, 1000)).toEqual({
      corners: null,
      status: "searching",
    });
  });
});
