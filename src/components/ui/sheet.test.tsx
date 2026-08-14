import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  LAYOUT_HEIGHT,
  fakeViewport,
  releaseViewport,
} from "../../../tests/helpers/viewport";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

/**
 * That a bottom sheet gets out from under the keyboard.
 *
 * This is the one thing about the sheet that cannot be seen in a desktop
 * browser: there is no soft keyboard there, so `visualViewport` never shrinks
 * and the interesting branch never runs. So the viewport is faked, which is
 * also the only way to assert the arithmetic — a phone can show the bug but
 * cannot tell you the sheet moved by exactly the right number of pixels.
 */

afterEach(releaseViewport);

function renderSheet() {
  render(
    <Sheet open>
      <SheetContent side="bottom" className="max-h-[86vh]">
        <SheetTitle>Currency</SheetTitle>
      </SheetContent>
    </Sheet>,
  );
  return screen.getByRole("dialog");
}

describe("a bottom sheet with the keyboard open", () => {
  it("sits on top of the keyboard instead of behind it", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    const sheet = renderSheet();

    expect(sheet.style.bottom).toBe("");

    viewport.keyboard(336);

    expect(sheet.style.bottom).toBe("336px");
    // And gives up the height it just moved through, or the top of the sheet
    // would leave the screen in exchange for the bottom arriving.
    expect(sheet.style.maxHeight).toBe("calc(100dvh - 352px)");
  });

  it("drops back to the bottom edge when the keyboard goes away", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    const sheet = renderSheet();

    viewport.keyboard(336);
    viewport.keyboard(0);

    expect(sheet.style.bottom).toBe("");
    expect(sheet.style.maxHeight).toBe("");
  });

  /**
   * iOS scrolls the visual viewport within the layout one to keep the focused
   * field in sight. That part of the gap is not keyboard, and counting it
   * would push the sheet up past the keyboard by however far the page moved.
   */
  it("does not count a scrolled visual viewport as more keyboard", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    const sheet = renderSheet();

    viewport.offsetTop = 120;
    viewport.keyboard(336);

    expect(sheet.style.bottom).toBe("216px");
  });

  /**
   * The two viewports disagree by a few pixels as browser chrome collapses.
   * Reading that as a keyboard would leave every sheet floating slightly off
   * the bottom edge for no reason.
   */
  it("ignores a gap too small to be a keyboard", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    const sheet = renderSheet();

    viewport.keyboard(44);

    expect(sheet.style.bottom).toBe("");
  });

  /** A side sheet is not anchored to the edge the keyboard comes from. */
  it("leaves a side sheet alone", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    render(
      <Sheet open>
        <SheetContent side="right">
          <SheetTitle>Filters</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    viewport.keyboard(336);

    expect(screen.getByRole("dialog").style.bottom).toBe("");
  });
});
