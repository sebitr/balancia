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

/**
 * Pushing a sheet away, and not pushing it away by accident.
 *
 * The interesting case is the tall sheet, which keeps its header and footer
 * fixed and scrolls a body inside instead. Its own `scrollTop` is 0 whatever
 * the body is doing, so a gesture that consulted only the sheet armed itself
 * on every touch — and the body could then be scrolled down but never back up,
 * because the swipe that would scroll it up dismissed the sheet instead.
 */
describe("pushing a bottom sheet away", () => {
  function renderTallSheet() {
    render(
      <Sheet open>
        {/* The shape the add-entry drawer and the group sheet both take. */}
        <SheetContent side="bottom" className="overflow-hidden">
          <SheetTitle>Add expense</SheetTitle>
          <div data-testid="body" className="overflow-y-auto">
            <p data-testid="row">A row some way down the list</p>
          </div>
        </SheetContent>
      </Sheet>,
    );
    return {
      sheet: screen.getByRole("dialog"),
      body: screen.getByTestId("body"),
      row: screen.getByTestId("row"),
    };
  }

  /** jsdom ships no `PointerEvent`, and only four of its fields are read. */
  function touch(target: Element, type: string, clientY: number) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 1,
      clientY,
    });
    target.dispatchEvent(event);
  }

  /**
   * Also the guard on the binding itself. The gesture used to read the sheet
   * from a ref on a commit where Radix's portal had not rendered the content
   * yet, so the listeners went nowhere and this moved nothing.
   */
  it("follows a downward drag that starts at the top of the body", () => {
    const { sheet, row } = renderTallSheet();

    touch(row, "pointerdown", 100);
    touch(row, "pointermove", 140);

    expect(sheet.style.transform).toBe("translate3d(0, 40px, 0)");
  });

  /** The regression: the body scrolls, and the sheet stays where it is. */
  it("leaves a scrolled body to scroll itself back up", () => {
    const { sheet, body, row } = renderTallSheet();
    body.scrollTop = 120;

    touch(row, "pointerdown", 100);
    touch(row, "pointermove", 140);

    expect(sheet.style.transform).toBe("");
  });

  it("does not lift the sheet off the bottom edge on an upward swipe", () => {
    const { sheet, row } = renderTallSheet();

    touch(row, "pointerdown", 100);
    touch(row, "pointermove", 60);

    expect(sheet.style.transform).toBe("");
  });
});

/**
 * The short sheets — currency, category, the payment methods — scroll their
 * own content rather than a body inside, and must keep doing so.
 */
describe("a sheet that scrolls itself", () => {
  it("reads its own scroll position", () => {
    render(
      <Sheet open>
        <SheetContent side="bottom" className="overflow-y-auto">
          <SheetTitle>Currency</SheetTitle>
          <p data-testid="row">CHF</p>
        </SheetContent>
      </Sheet>,
    );
    const sheet = screen.getByRole("dialog");
    const row = screen.getByTestId("row");

    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 1,
      clientY: 100,
    });
    sheet.scrollTop = 90;
    row.dispatchEvent(event);

    const move = new Event("pointermove", { bubbles: true, cancelable: true });
    Object.assign(move, { pointerId: 1, clientY: 140 });
    row.dispatchEvent(move);

    expect(sheet.style.transform).toBe("");
  });
});
