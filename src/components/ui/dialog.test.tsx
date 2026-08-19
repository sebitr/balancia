import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  LAYOUT_HEIGHT,
  fakeViewport,
  releaseViewport,
} from "../../../tests/helpers/viewport";
import { AlertDialog, AlertDialogContent } from "./alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

/**
 * That a dialog gets out from under the keyboard.
 *
 * A dialog is centred with `top-1/2`, which is the middle of the *layout*
 * viewport — and a phone keyboard slides over that rather than shortening it.
 * So the settle-up dialog put its amount, its date, its note and the button
 * that submits them behind the keyboard as soon as the first field took focus.
 *
 * Faking the viewport is the only way to see this: a desktop browser has no
 * soft keyboard, so `visualViewport` never shrinks and the branch never runs.
 * It is also the only way to assert the arithmetic — a phone can show the bug
 * but cannot tell you the dialog moved by exactly the right number of pixels.
 */

afterEach(releaseViewport);

describe("a dialog with the keyboard open", () => {
  it("centres itself in the room the keyboard has left", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Settle up</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");

    expect(dialog.style.top).toBe("calc(50dvh - 0px)");

    viewport.keyboard(336);

    // Half of what is left, not half of a viewport the keyboard is sitting on.
    expect(dialog.style.top).toBe("calc(50dvh - 168px)");
    // And it may not grow back into the keyboard it just moved out of.
    expect(dialog.style.maxHeight).toBe("calc(100dvh - 368px)");
  });

  it("goes back to the middle when the keyboard goes away", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Settle up</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");

    viewport.keyboard(336);
    viewport.keyboard(0);

    expect(dialog.style.top).toBe("calc(50dvh - 0px)");
    expect(dialog.style.maxHeight).toBe("calc(100dvh - 32px)");
  });

  /**
   * Two of these ask you to type before they will act — the group name that
   * confirms a deletion, the label on a new passkey — so the confirm dialog
   * needs the same treatment as the plain one.
   */
  it("does the same for the confirm dialog", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    render(
      <AlertDialog open>
        <AlertDialogContent aria-label="Delete group" />
      </AlertDialog>,
    );
    const dialog = screen.getByRole("alertdialog");

    viewport.keyboard(291);

    expect(dialog.style.top).toBe("calc(50dvh - 145.5px)");
    expect(dialog.style.maxHeight).toBe("calc(100dvh - 323px)");
  });

  /**
   * iOS scrolls the visual viewport within the layout one to keep the focused
   * field in sight. That part of the gap is not keyboard, and counting it
   * would lift the dialog by however far the page happened to have moved.
   */
  it("does not count a scrolled visual viewport as more keyboard", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Settle up</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");

    viewport.offsetTop = 120;
    viewport.keyboard(336);

    expect(dialog.style.top).toBe("calc(50dvh - 108px)");
  });
});
