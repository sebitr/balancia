import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { Toaster, toastUndoable } from "./sonner";

/**
 * The ways out of a toast, and the glyph it arrives with.
 *
 * A toast is the one surface with no second chance: it says what happened,
 * offers the only way back, and then leaves. So each way out is pinned here —
 * the close button and a tap anywhere on it, the two this file adds on top of
 * the swipe sonner already owns — along with the rule that tells a tap from a
 * swipe, which is what a stray drag on a phone runs into.
 */

/**
 * Sonner runs on timers — a `setTimeout` to raise a toast, a frame to dismiss
 * one, and 200ms of exit animation before it lets go — and each of them ends
 * in a React state update. Left real, the last test's exit timer fired after
 * Vitest had torn jsdom down, React reached for `window`, and CI reported an
 * unhandled error against a file whose every test had passed. So those timers
 * are fakes, which the `afterEach` below can see and run before a test is
 * allowed to end.
 *
 * Only the four sonner reaches for are faked; React's scheduler, which runs on
 * `setImmediate`, keeps the real ones. And the fake clock still follows the
 * wall clock, because Testing Library ends every user-event call on a
 * `setTimeout(0)` of its own and only knows how to move Jest's fake clock, not
 * this one.
 */
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
    shouldAdvanceTime: true,
  });
});

/**
 * Sonner's store outlives the render and replays whatever is still live to the
 * next `Toaster` that subscribes, so a toast left standing turns up in the
 * following test.
 *
 * Dismissing it is not the end of it: every step of the exit is set off by
 * the render the step before it caused, and `act` only renders on its way
 * out. So the timers run one pass per `act` until none is left — the frame
 * that marks the toast deleted, the exit its effect then starts, and any
 * dismissal that exit publishes in turn. A handful of passes is the whole of
 * it; one that never settles is a loop, and says so rather than hanging.
 */
afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  for (let pass = 0; vi.getTimerCount() > 0; pass++) {
    if (pass === 20) {
      throw new Error("sonner's timers are still rescheduling themselves");
    }
    act(() => {
      vi.runOnlyPendingTimers();
    });
  }
  vi.useRealTimers();
});

/**
 * Raises a toast and waits for it.
 *
 * Sonner hands its store's updates to a `setTimeout` to keep them out of
 * React's batching, so a toast raised inside `act` is not on screen until that
 * timer has run.
 */
function raise(show: () => void) {
  act(() => {
    show();
    vi.advanceTimersByTime(0);
  });
}

/** The toast element itself, which is what the tap handler reads from. */
function toastElement() {
  const element = document.querySelector<HTMLElement>("[data-sonner-toast]");
  if (!element) throw new Error("no toast on screen");
  return element;
}

function glyph() {
  const element = document.querySelector<HTMLElement>("[data-icon] > span");
  if (!element) throw new Error("the toast came without a glyph");
  return element;
}

describe("the toaster", () => {
  /**
   * The region the toasts live in is a landmark, and a screen reader lists it
   * by name. Sonner's own was an English "Notifications" on every page.
   */
  it("names its region in the reader's language", () => {
    renderWithIntl(<Toaster />, { locale: "fr" });

    const region = document.querySelector("section[aria-label]");
    expect(region?.getAttribute("aria-label")).toMatch(/^Messages d’état\b/);
  });
});

describe("a toast", () => {
  it("leads a confirmation with the positive tone and a check", () => {
    renderWithIntl(<Toaster />);
    raise(() => toast.success("Saved"));

    expect(screen.getByText("Saved")).toBeVisible();
    expect(glyph().className).toContain("text-positive-ink");
    expect(glyph().querySelector("svg")?.getAttribute("class")).toContain(
      "check",
    );
  });

  it("leads a failure with the destructive tone and an alert", () => {
    renderWithIntl(<Toaster />);
    raise(() => toast.error("Nope"));

    expect(glyph().className).toContain("text-destructive");
    expect(glyph().querySelector("svg")?.getAttribute("class")).toContain(
      "alert",
    );
  });

  it("goes away when it is tapped anywhere", () => {
    renderWithIntl(<Toaster />);
    raise(() => toast.success("Saved"));

    const element = toastElement();
    fireEvent.pointerDown(element, { clientX: 120, clientY: 60 });
    fireEvent.click(element, { clientX: 120, clientY: 60 });

    expect(element).toHaveAttribute("data-removed", "true");
  });

  it("stays put when the pointer was swiping and thought better of it", () => {
    renderWithIntl(<Toaster />);
    raise(() => toast.success("Saved"));

    // Down, dragged up, released short of the threshold: sonner puts the toast
    // back, and the click that follows must not take it away again.
    const element = toastElement();
    fireEvent.pointerDown(element, { clientX: 120, clientY: 60 });
    fireEvent.click(element, { clientX: 122, clientY: 20 });

    expect(element).not.toHaveAttribute("data-removed", "true");
  });

  it("leaves its own buttons to say what they do", async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    renderWithIntl(<Toaster />);
    raise(() =>
      toastUndoable("Cyril removed from the group", {
        label: "Undo",
        onUndo,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));

    // Once. The tap handler did not fire as well and dismiss the toast out
    // from under the button that was pressed.
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("keeps the facts it is decided on beside its Undo", () => {
    renderWithIntl(<Toaster />);
    raise(() =>
      toastUndoable(
        "Repayment recorded",
        { label: "Undo", onUndo: vi.fn() },
        { description: "CHF 30.00 · Grace paid you back" },
      ),
    );

    // Who paid whom back is what tells the right repayment from the wrong
    // one, so it is on the card the Undo is on, not behind it.
    expect(screen.getByText("CHF 30.00 · Grace paid you back")).toBeVisible();
    expect(screen.getByRole("button", { name: "Undo" })).toBeVisible();
  });

  it("replaces the confirmation it was told to name", () => {
    renderWithIntl(<Toaster />);
    const saved = () =>
      toastUndoable(
        "Changes saved",
        { label: "Undo", onUndo: vi.fn() },
        { id: "group-settings" },
      );

    // A settings card writing itself as it is edited says this over and over;
    // a named toast is one surface being updated, not a column being built.
    raise(saved);
    raise(saved);

    expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(1);
  });

  it("names its close button in the reader's language", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Toaster />, { locale: "fr" });
    raise(() => toast.success("Enregistré"));

    await user.click(screen.getByRole("button", { name: "Fermer" }));

    expect(toastElement()).toHaveAttribute("data-removed", "true");
  });
});
