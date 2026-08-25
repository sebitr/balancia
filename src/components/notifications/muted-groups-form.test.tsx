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
 *
 * The switch reads as the group's *voice* rather than as its mute — on means
 * it can still reach you — so every assertion here checks the two against each
 * other. A switch wired straight through to the stored flag would pass a test
 * that only looked at one of them, and would mute every group the reader meant
 * to keep.
 */

const { setGroupMutedAction, toastUndoable } = vi.hoisted(() => ({
  setGroupMutedAction: vi.fn(),
  toastUndoable: vi.fn(),
}));

vi.mock("@/modules/notifications/actions", () => ({ setGroupMutedAction }));
vi.mock("@/components/ui/sonner", () => ({ toastUndoable, UNDO_WINDOW: 8000 }));

function renderForm(
  groups = [
    { id: "g1", name: "Lisbon trip", muted: false },
    { id: "g2", name: "Flat", muted: false },
  ],
) {
  setGroupMutedAction.mockReset();
  setGroupMutedAction.mockResolvedValue({ ok: true });
  toastUndoable.mockReset();
  const view = renderWithIntl(<MutedGroupsForm groups={groups} />);
  return { ...view, user: userEvent.setup() };
}

/** The way back the newest confirmation offered. */
function offeredUndo(): () => void {
  const newest = toastUndoable.mock.calls.at(-1);
  if (!newest) throw new Error("nothing was confirmed");
  return newest[1].onUndo;
}

const voiceOf = (name: string) => screen.getByRole("switch", { name });

describe("MutedGroupsForm", () => {
  it("silences a group, and offers to let it speak again", async () => {
    const { user } = renderForm();

    expect(voiceOf("Lisbon trip")).toBeChecked();
    await user.click(voiceOf("Lisbon trip"));

    // Switched off is muted: the flag the server is told is the opposite of
    // the one the reader sees.
    await waitFor(() =>
      expect(setGroupMutedAction).toHaveBeenCalledWith("g1", true),
    );
    expect(voiceOf("Lisbon trip")).not.toBeChecked();

    await act(async () => offeredUndo()());

    await waitFor(() =>
      expect(setGroupMutedAction).toHaveBeenLastCalledWith("g1", false),
    );
    expect(voiceOf("Lisbon trip")).toBeChecked();
    // Undoing is not itself something to undo, so it says nothing.
    expect(toastUndoable).toHaveBeenCalledOnce();
  });

  it("keeps a way back for each group", async () => {
    const { user } = renderForm();

    await user.click(voiceOf("Lisbon trip"));
    await waitFor(() => expect(voiceOf("Lisbon trip")).toBeEnabled());
    await user.click(voiceOf("Flat"));

    await waitFor(() => expect(toastUndoable).toHaveBeenCalledTimes(2));
    expect(toastUndoable.mock.calls.map((call) => call[2]?.id)).toEqual([
      "muted-g1",
      "muted-g2",
    ]);
  });

  it("puts the switch back when the write is refused", async () => {
    const { user } = renderForm();
    setGroupMutedAction.mockResolvedValue({ ok: false });

    await user.click(voiceOf("Lisbon trip"));

    await waitFor(() => expect(voiceOf("Lisbon trip")).toBeChecked());
    expect(toastUndoable).not.toHaveBeenCalled();
  });

  it("starts a muted group switched off", () => {
    renderForm([{ id: "g1", name: "Lisbon trip", muted: true }]);
    expect(voiceOf("Lisbon trip")).not.toBeChecked();
  });

  it("shows three groups, and the rest on request", async () => {
    const { user } = renderForm(
      ["Lisbon trip", "Flat", "Chalet", "Office", "Boat"].map(
        (name, index) => ({
          id: `g${index}`,
          name,
          muted: false,
        }),
      ),
    );

    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.queryByRole("switch", { name: "Boat" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show all 5 groups" }));
    expect(screen.getAllByRole("switch")).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getAllByRole("switch")).toHaveLength(3);
  });

  it("does not offer to open out a list that is already whole", () => {
    renderForm([
      { id: "g1", name: "Lisbon trip", muted: false },
      { id: "g2", name: "Flat", muted: false },
      { id: "g3", name: "Chalet", muted: false },
    ]);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
