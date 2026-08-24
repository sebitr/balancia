import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { MutedGroupsForm } from "./muted-groups-form";

/**
 * Per-group silence.
 *
 * Silencing one group is one decision, so each row confirms itself and keeps
 * its own way back: muting a second group must not take away the chance to
 * unmute the first from its own toast.
 */

const { setGroupMutedAction, toastUndoable } = vi.hoisted(() => ({
  setGroupMutedAction: vi.fn(),
  toastUndoable: vi.fn(),
}));

vi.mock("@/modules/notifications/actions", () => ({ setGroupMutedAction }));
vi.mock("@/components/ui/sonner", () => ({ toastUndoable, UNDO_WINDOW: 8000 }));

function renderForm() {
  setGroupMutedAction.mockReset();
  setGroupMutedAction.mockResolvedValue({ ok: true });
  toastUndoable.mockReset();
  const view = renderWithIntl(
    <MutedGroupsForm
      groups={[
        { id: "g1", name: "Lisbon trip", muted: false },
        { id: "g2", name: "Flat", muted: false },
      ]}
    />,
  );
  return { ...view, user: userEvent.setup() };
}

/** The way back the newest confirmation offered. */
function offeredUndo(): () => void {
  const newest = toastUndoable.mock.calls.at(-1);
  if (!newest) throw new Error("nothing was confirmed");
  return newest[1].onUndo;
}

const muteButtons = () => screen.getAllByRole("button", { name: "Mute" });

describe("MutedGroupsForm", () => {
  it("silences a group, and offers to let it speak again", async () => {
    const { user } = renderForm();

    await user.click(muteButtons()[0]);

    await waitFor(() =>
      expect(setGroupMutedAction).toHaveBeenCalledWith("g1", true),
    );
    expect(screen.getByText("Muted")).toBeInTheDocument();

    await act(async () => offeredUndo()());

    await waitFor(() =>
      expect(setGroupMutedAction).toHaveBeenLastCalledWith("g1", false),
    );
    expect(screen.queryByText("Muted")).not.toBeInTheDocument();
    // Undoing is not itself something to undo, so it says nothing.
    expect(toastUndoable).toHaveBeenCalledOnce();
  });

  it("keeps a way back for each group", async () => {
    const { user } = renderForm();

    await user.click(muteButtons()[0]);
    await waitFor(() => expect(muteButtons()[0]).toBeEnabled());
    await user.click(muteButtons()[0]);

    await waitFor(() => expect(toastUndoable).toHaveBeenCalledTimes(2));
    expect(toastUndoable.mock.calls.map((call) => call[2]?.id)).toEqual([
      "muted-g1",
      "muted-g2",
    ]);
  });

  it("puts the row back when the write is refused", async () => {
    const { user } = renderForm();
    setGroupMutedAction.mockResolvedValue({ ok: false });

    await user.click(muteButtons()[0]);

    await waitFor(() => expect(screen.queryByText("Muted")).toBeNull());
    expect(toastUndoable).not.toHaveBeenCalled();
  });
});
