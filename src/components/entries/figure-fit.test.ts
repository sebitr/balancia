import { describe, expect, it } from "vitest";
import {
  CHIP_MAX_PX,
  CHIP_MIN_PX,
  chipFreedPx,
  chipPxFor,
  FIGURE_MAX_PX,
  FIGURE_MIN_PX,
  fittedFigurePx,
} from "./figure-fit";

/**
 * The arithmetic behind a figure that fits.
 *
 * The measuring itself belongs to the browser — jsdom gives every box a width
 * of zero, which is exactly the case the first test pins down — so what is
 * checked here is what the two widths are turned into.
 */

describe("the size a figure is drawn at", () => {
  it("is the designed one whenever the text already fits", () => {
    expect(fittedFigurePx(200, 120)).toBe(FIGURE_MAX_PX);
    expect(fittedFigurePx(200, 197)).toBe(FIGURE_MAX_PX);
  });

  /**
   * Filling the field to its last pixel is not fitting. The caret has to stand
   * somewhere after the last digit, and a browser that cannot find it room
   * scrolls the field — taking a sliver off the first digit instead.
   */
  it("keeps a couple of pixels back for the caret", () => {
    expect(fittedFigurePx(200, 200)).toBe(43);
  });

  /**
   * Server-rendered, inside a closed sheet, or under a test: no box has been
   * laid out yet and every width reads zero. Shrinking on that would draw the
   * figure at the floor before anybody had typed a digit.
   */
  it("is the designed one when there is nothing to measure", () => {
    expect(fittedFigurePx(0, 0)).toBe(FIGURE_MAX_PX);
    expect(fittedFigurePx(0, 300)).toBe(FIGURE_MAX_PX);
    expect(fittedFigurePx(200, 0)).toBe(FIGURE_MAX_PX);
  });

  it("scales by the ratio the text overflows by", () => {
    // Half again as wide as the room, so two thirds of the size.
    expect(fittedFigurePx(200, 300)).toBe(29);
  });

  /**
   * Down, never to the nearest. Rounding up would put the text a hair wider
   * than the field it was just measured into, which is the whole of what this
   * exists to stop.
   */
  it("rounds the size down", () => {
    expect(fittedFigurePx(190, 230)).toBe(35);
  });

  it("stops at the floor rather than shrinking to nothing", () => {
    expect(fittedFigurePx(20, 2000)).toBe(FIGURE_MIN_PX);
  });

  /**
   * The floor is the one number here that is not free to move. Under 16px
   * Safari on iOS zooms the page in when the field takes focus and never zooms
   * back out, so a figure that shrank past it would cost a pinch per tap — and
   * the usual guard cannot help, because `text-entry-size.test.ts` reads class
   * names and this size is set inline.
   */
  it("never lands under the size that makes iOS zoom", () => {
    expect(FIGURE_MIN_PX).toBeGreaterThanOrEqual(16);
  });
});

describe("the chip beside it", () => {
  it("stands at full height beside a figure that never had to shrink", () => {
    expect(chipPxFor(FIGURE_MAX_PX)).toBe(CHIP_MAX_PX);
  });

  it("keeps the figure's proportion on the way down", () => {
    // The settlement that started this: a 375px phone has room for 39px of
    // figure beside a full-size chip, so the chip is drawn at 21 — and the
    // figure then settles at 42 in the width that freed.
    expect(chipPxFor(39)).toBe(21);
    expect(chipPxFor(32)).toBe(17);
  });

  /**
   * A pill drawn at the floor is 34px tall, which is why the chip carries
   * `tap-target`: what a finger has to hit stays 44px however small the pill
   * is drawn. Below this the code stops reading as one.
   */
  it("stops at its own floor rather than following the figure down", () => {
    expect(chipPxFor(FIGURE_MIN_PX)).toBe(CHIP_MIN_PX);
    expect(chipPxFor(0)).toBe(CHIP_MIN_PX);
  });

  /**
   * What the smaller pill frees goes to the figure, so it has to be counted
   * rather than guessed at: the whole reason both sizes are settled in one
   * pass is that a figure which grew into this width could not be allowed to
   * pull the chip back out again.
   */
  it("gives the figure back the width it no longer takes", () => {
    // A 132px pill at full size: the border is two of those pixels and does
    // not scale, the other 130 do.
    expect(chipFreedPx(CHIP_MAX_PX, 132)).toBe(0);
    expect(chipFreedPx(CHIP_MIN_PX, 132)).toBe(37);
    // Nothing measured yet, so nothing to give back.
    expect(chipFreedPx(CHIP_MIN_PX, 0)).toBe(0);
  });
});
