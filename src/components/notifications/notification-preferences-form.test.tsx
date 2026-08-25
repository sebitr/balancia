import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { NotificationPreferencesForm } from "./notification-preferences-form";

/**
 * The switches that decide what raises a notification at all.
 *
 * Each is written as it is flicked and confirms itself, and each keeps its own
 * way back — flicking a second switch must not take away the chance to undo
 * the first. A refused write puts the switch back rather than leaving it lying
 * about what was saved.
 */

const { savePreferencesAction, toastUndoable } = vi.hoisted(() => ({
  savePreferencesAction: vi.fn(),
  toastUndoable: vi.fn(),
}));

vi.mock("@/modules/notifications/actions", () => ({ savePreferencesAction }));
vi.mock("@/components/ui/sonner", () => ({ toastUndoable, UNDO_WINDOW: 8000 }));

const ALL_ON = {
  expenses: true,
  settlements: true,
  recurring: true,
  imports: true,
  reminders: true,
};

function renderForm() {
  savePreferencesAction.mockReset();
  savePreferencesAction.mockResolvedValue({ ok: true });
  toastUndoable.mockReset();
  const view = renderWithIntl(
    <NotificationPreferencesForm defaultValue={ALL_ON} />,
  );
  return { ...view, user: userEvent.setup() };
}

/** The way back the newest confirmation offered. */
function offeredUndo(): () => void {
  const newest = toastUndoable.mock.calls.at(-1);
  if (!newest) throw new Error("nothing was confirmed");
  return newest[1].onUndo;
}

const expenses = () => screen.getByRole("switch", { name: "Expenses I am in" });

describe("NotificationPreferencesForm", () => {
  it("writes a switch as it is flicked, and offers to flick it back", async () => {
    const { user } = renderForm();

    await user.click(expenses());

    await waitFor(() =>
      expect(savePreferencesAction).toHaveBeenCalledWith({
        ...ALL_ON,
        expenses: false,
      }),
    );
    expect(expenses()).not.toBeChecked();

    await act(async () => offeredUndo()());

    await waitFor(() =>
      expect(savePreferencesAction).toHaveBeenLastCalledWith(ALL_ON),
    );
    expect(expenses()).toBeChecked();
    // Undoing is not itself something to undo, so it says nothing.
    expect(toastUndoable).toHaveBeenCalledOnce();
  });

  it("keeps a way back for each switch", async () => {
    const { user } = renderForm();

    await user.click(expenses());
    await waitFor(() => expect(expenses()).toBeEnabled());
    await user.click(screen.getByRole("switch", { name: "Reminders" }));

    await waitFor(() => expect(toastUndoable).toHaveBeenCalledTimes(2));
    expect(toastUndoable.mock.calls.map((call) => call[2]?.id)).toEqual([
      "notify-expenses",
      "notify-reminders",
    ]);
  });

  it("puts the switch back when the write is refused", async () => {
    const { user } = renderForm();
    savePreferencesAction.mockResolvedValue({ ok: false });

    await user.click(expenses());

    await waitFor(() => expect(expenses()).toBeChecked());
    expect(toastUndoable).not.toHaveBeenCalled();
  });
});
