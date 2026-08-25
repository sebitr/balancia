import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { FormatChoices } from "./format-choices";

/**
 * How dates and numbers are written.
 *
 * Two cards saved by one action, but they are two decisions: each confirms
 * itself, each keeps its own way back, and changing one must not take away the
 * chance to undo the other. A refused write puts its card back, because a card
 * left showing a choice the account did not keep is worse than no confirmation
 * at all.
 *
 * The rows are radios rather than a `<select>` now, so each is found by the
 * sample it labels itself with — which is also the only thing the reader has to
 * go on, and therefore worth asserting on rather than routing around.
 */

const { setFormatPreferencesAction, toastUndoable } = vi.hoisted(() => ({
  setFormatPreferencesAction: vi.fn(),
  toastUndoable: vi.fn(),
}));

vi.mock("@/modules/profile/actions", () => ({ setFormatPreferencesAction }));
vi.mock("@/components/ui/sonner", () => ({ toastUndoable, UNDO_WINDOW: 8000 }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderChoices() {
  setFormatPreferencesAction.mockReset();
  setFormatPreferencesAction.mockResolvedValue({ ok: true });
  toastUndoable.mockReset();
  const view = renderWithIntl(<FormatChoices />);
  return { ...view, user: userEvent.setup() };
}

/** The way back the newest confirmation offered. */
function offeredUndo(): () => void {
  const newest = toastUndoable.mock.calls.at(-1);
  if (!newest) throw new Error("nothing was confirmed");
  return newest[1].onUndo;
}

const card = (label: string) =>
  within(screen.getByRole("radiogroup", { name: label }));

/** Every option names itself with the notation it produces. */
const DMY = "13/08/2026";
const DOT_COMMA = "1.234.567,89";

describe("FormatChoices", () => {
  it("writes a choice as it is made, and offers back the one it replaced", async () => {
    const { user } = renderChoices();

    await user.click(card("Dates").getByRole("radio", { name: DMY }));

    await waitFor(() =>
      expect(setFormatPreferencesAction).toHaveBeenCalledWith({
        dateFormat: "dmy",
        numberFormat: "auto",
      }),
    );
    expect(card("Dates").getByRole("radio", { name: DMY })).toBeChecked();

    await act(async () => offeredUndo()());

    await waitFor(() =>
      expect(setFormatPreferencesAction).toHaveBeenLastCalledWith({
        dateFormat: "auto",
        numberFormat: "auto",
      }),
    );
    expect(card("Dates").getByRole("radio", { name: DMY })).not.toBeChecked();
    // Undoing is not itself something to undo, so it says nothing.
    expect(toastUndoable).toHaveBeenCalledOnce();
  });

  it("keeps a way back for each card", async () => {
    const { user } = renderChoices();

    await user.click(card("Dates").getByRole("radio", { name: DMY }));
    await waitFor(() =>
      expect(
        card("Numbers").getByRole("radio", { name: DOT_COMMA }),
      ).toBeEnabled(),
    );
    await user.click(card("Numbers").getByRole("radio", { name: DOT_COMMA }));

    await waitFor(() => expect(toastUndoable).toHaveBeenCalledTimes(2));
    expect(toastUndoable.mock.calls.map((call) => call[2]?.id)).toEqual([
      "format-dateFormat",
      "format-numberFormat",
    ]);
  });

  it("does not lose the other card's choice when one is changed", async () => {
    const { user } = renderChoices();

    await user.click(card("Numbers").getByRole("radio", { name: DOT_COMMA }));
    await waitFor(() => expect(toastUndoable).toHaveBeenCalledOnce());

    await user.click(card("Dates").getByRole("radio", { name: DMY }));

    // One action writes both, so the second write has to carry the first
    // choice forward rather than sending the value the page was loaded with.
    await waitFor(() =>
      expect(setFormatPreferencesAction).toHaveBeenLastCalledWith({
        dateFormat: "dmy",
        numberFormat: "dot-comma",
      }),
    );
  });

  it("puts the card back when the write is refused", async () => {
    const { user } = renderChoices();
    setFormatPreferencesAction.mockResolvedValue({ ok: false });

    await user.click(card("Dates").getByRole("radio", { name: DMY }));

    await waitFor(() =>
      expect(card("Dates").getByRole("radio", { name: DMY })).not.toBeChecked(),
    );
    expect(toastUndoable).not.toHaveBeenCalled();
  });
});
