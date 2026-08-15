import {
  cornerMovement,
  smoothCorners,
  type DocumentCorners,
} from "./geometry";

/**
 * Temporal behaviour of the detected outline: smoothing, so raw detections do
 * not jitter on screen, and stability, so capture readiness means "this
 * document has actually held still" rather than "a quadrilateral existed for
 * one frame".
 *
 * The tracker works entirely in normalized coordinates and knows nothing
 * about cameras, canvases or React; time comes in as an argument. That keeps
 * every rule here — the snap on a new contour, the grace for a missed frame,
 * the hold timer — testable with plain numbers.
 */

export type ScannerStatus = "searching" | "detected" | "hold-still" | "ready";

export interface TrackerOptions {
  /** EMA weight of the newest detection; higher follows faster. */
  readonly alpha: number;
  /**
   * Mean normalized movement above which the detection is a *different*
   * contour, not the tracked one having moved. Smoothing across such a jump
   * would animate the outline across the screen, so it snaps instead.
   */
  readonly snapDistance: number;
  /** Mean normalized movement per update below which the page counts as still. */
  readonly stillDistance: number;
  /** How long the page must stay still before it is ready to capture. */
  readonly holdMs: number;
  /**
   * Consecutive missed detections forgiven before the outline is dropped.
   * Detection at ~7 Hz occasionally loses one frame to a hand shadow; hiding
   * the outline for every such blink makes it flicker.
   */
  readonly maxMisses: number;
}

export const TRACKER_DEFAULTS: TrackerOptions = {
  alpha: 0.3,
  snapDistance: 0.15,
  stillDistance: 0.008,
  holdMs: 600,
  maxMisses: 2,
};

export interface TrackerState {
  /** Smoothed, normalized corners — what the overlay should draw. */
  readonly corners: DocumentCorners | null;
  readonly status: ScannerStatus;
}

export class CornerTracker {
  readonly #options: TrackerOptions;
  #smoothed: DocumentCorners | null = null;
  #stillSinceMs: number | null = null;
  #misses = 0;

  constructor(options?: Partial<TrackerOptions>) {
    this.#options = { ...TRACKER_DEFAULTS, ...options };
  }

  reset(): void {
    this.#smoothed = null;
    this.#stillSinceMs = null;
    this.#misses = 0;
  }

  update(detected: DocumentCorners | null, timestampMs: number): TrackerState {
    if (detected === null) {
      this.#misses += 1;
      // A missed frame interrupts the hold either way: readiness must mean
      // continuously observed stillness, not stillness with gaps.
      this.#stillSinceMs = null;
      if (this.#smoothed === null || this.#misses > this.#options.maxMisses) {
        this.reset();
        return { corners: null, status: "searching" };
      }
      return { corners: this.#smoothed, status: "detected" };
    }

    this.#misses = 0;

    if (
      this.#smoothed === null ||
      cornerMovement(this.#smoothed, detected) > this.#options.snapDistance
    ) {
      this.#smoothed = detected;
      this.#stillSinceMs = null;
      return { corners: this.#smoothed, status: "detected" };
    }

    const next = smoothCorners(this.#smoothed, detected, this.#options.alpha);
    const movement = cornerMovement(this.#smoothed, next);
    this.#smoothed = next;

    if (movement > this.#options.stillDistance) {
      this.#stillSinceMs = null;
      return { corners: next, status: "detected" };
    }

    this.#stillSinceMs ??= timestampMs;
    const heldLongEnough =
      timestampMs - this.#stillSinceMs >= this.#options.holdMs;
    return {
      corners: next,
      status: heldLongEnough ? "ready" : "hold-still",
    };
  }
}
