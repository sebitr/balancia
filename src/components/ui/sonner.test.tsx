import { afterEach, describe, expect, it, vi } from "vitest";
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
 * Sonner's store outlives the render and replays whatever is still live to the
 * next `Toaster` that subscribes, so a toast left standing turns up in the
 * following test.
 */
afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

/**
 * Raises a toast and waits for it.
 *
 * Sonner hands its store's updates to a `setTimeout` to keep them out of
 * React's batching, so a toast raised inside `act` is not on screen when `act`
 * returns — the macrotask has to be let through first.
 */
async function raise(show: () => void) {
  await act(async () => {
    show();
    await new Promise((resolve) => setTimeout(resolve, 0));
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

describe("a toast", () => {
  it("leads a confirmation with the positive tone and a check", async () => {
    renderWithIntl(<Toaster />);
    await raise(() => toast.success("Saved"));

    expect(screen.getByText("Saved")).toBeVisible();
    expect(glyph().className).toContain("text-positive");
    expect(glyph().querySelector("svg")?.getAttribute("class")).toContain(
      "check",
    );
  });

  it("leads a failure with the destructive tone and an alert", async () => {
    renderWithIntl(<Toaster />);
    await raise(() => toast.error("Nope"));

    expect(glyph().className).toContain("text-destructive");
    expect(glyph().querySelector("svg")?.getAttribute("class")).toContain(
      "alert",
    );
  });

  it("goes away when it is tapped anywhere", async () => {
    renderWithIntl(<Toaster />);
    await raise(() => toast.success("Saved"));

    const element = toastElement();
    fireEvent.pointerDown(element, { clientX: 120, clientY: 60 });
    fireEvent.click(element, { clientX: 120, clientY: 60 });

    expect(element).toHaveAttribute("data-removed", "true");
  });

  it("stays put when the pointer was swiping and thought better of it", async () => {
    renderWithIntl(<Toaster />);
    await raise(() => toast.success("Saved"));

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
    await raise(() =>
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

  it("replaces the confirmation it was told to name", async () => {
    renderWithIntl(<Toaster />);
    const saved = () =>
      toastUndoable(
        "Changes saved",
        { label: "Undo", onUndo: vi.fn() },
        { id: "group-settings" },
      );

    // A settings card writing itself as it is edited says this over and over;
    // a named toast is one surface being updated, not a column being built.
    await raise(saved);
    await raise(saved);

    expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(1);
  });

  it("names its close button in the reader's language", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Toaster />, { locale: "fr" });
    await raise(() => toast.success("Enregistré"));

    await user.click(screen.getByRole("button", { name: "Fermer" }));

    expect(toastElement()).toHaveAttribute("data-removed", "true");
  });
});
