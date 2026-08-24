import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { FormatPreferencesForm } from "./format-preferences-form";

/**
 * How dates and numbers are written.
 *
 * Two rows saved by one action, but they are two decisions: each confirms
 * itself, each keeps its own way back, and changing one must not take away the
 * chance to undo the other. A refused write puts its row back, because a row
 * left showing a choice the account did not keep is worse than no
 * confirmation at all.
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

function renderForm() {
  setFormatPreferencesAction.mockReset();
  setFormatPreferencesAction.mockResolvedValue({ ok: true });
  toastUndoable.mockReset();
  const view = renderWithIntl(<FormatPreferencesForm />);
  return { ...view, user: userEvent.setup() };
}

/** The way back the newest confirmation offered. */
function offeredUndo(): () => void {
  const newest = toastUndoable.mock.calls.at(-1);
  if (!newest) throw new Error("nothing was confirmed");
  return newest[1].onUndo;
}

const dates = () => screen.getByLabelText("Write dates as");
const numbers = () => screen.getByLabelText("Write numbers as");

describe("FormatPreferencesForm", () => {
  it("writes a choice as it is made, and offers back the one it replaced", async () => {
    const { user } = renderForm();

    await user.selectOptions(dates(), "dmy");

    await waitFor(() =>
      expect(setFormatPreferencesAction).toHaveBeenCalledWith({
        dateFormat: "dmy",
        numberFormat: "auto",
      }),
    );

    await act(async () => offeredUndo()());

    await waitFor(() =>
      expect(setFormatPreferencesAction).toHaveBeenLastCalledWith({
        dateFormat: "auto",
        numberFormat: "auto",
      }),
    );
    expect(dates()).toHaveValue("auto");
    // Undoing is not itself something to undo, so it says nothing.
    expect(toastUndoable).toHaveBeenCalledOnce();
  });

  it("keeps a way back for each row", async () => {
    const { user } = renderForm();

    await user.selectOptions(dates(), "dmy");
    await waitFor(() => expect(numbers()).toBeEnabled());
    await user.selectOptions(numbers(), "dot-comma");

    await waitFor(() => expect(toastUndoable).toHaveBeenCalledTimes(2));
    expect(toastUndoable.mock.calls.map((call) => call[2]?.id)).toEqual([
      "format-dateFormat",
      "format-numberFormat",
    ]);
  });

  it("puts the row back when the write is refused", async () => {
    const { user } = renderForm();
    setFormatPreferencesAction.mockResolvedValue({ ok: false });

    await user.selectOptions(dates(), "dmy");

    await waitFor(() => expect(dates()).toHaveValue("auto"));
    expect(toastUndoable).not.toHaveBeenCalled();
  });
});
