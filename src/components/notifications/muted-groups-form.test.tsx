import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { MutedGroupsForm } from "./muted-groups-form";

/**
 * Per-group silence.
 *
 * Silencing a group says nothing back: the switch moved, it stayed moved, and
 * the way back is the same switch. A toast would have covered the row it was
 * describing to offer a button that does what the row already does, so its
 * absence is asserted here rather than left to drift.
 *
 * The switch reads as the group's *voice* rather than as its mute — on means
 * it can still reach you — so every assertion here checks the two against each
 * other. A switch wired straight through to the stored flag would pass a test
 * that only looked at one of them, and would mute every group the reader meant
 * to keep.
 */

const { setGroupMutedAction, toastSuccess, toastError } = vi.hoisted(() => ({
  setGroupMutedAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/notifications/actions", () => ({ setGroupMutedAction }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

function renderForm(
  groups = [
    { id: "g1", name: "Lisbon trip", muted: false },
    { id: "g2", name: "Flat", muted: false },
  ],
) {
  setGroupMutedAction.mockReset();
  setGroupMutedAction.mockResolvedValue({ ok: true });
  toastSuccess.mockReset();
  toastError.mockReset();
  const view = renderWithIntl(<MutedGroupsForm groups={groups} />);
  return { ...view, user: userEvent.setup() };
}

const voiceOf = (name: string) => screen.getByRole("switch", { name });

describe("MutedGroupsForm", () => {
  it("silences a group without announcing it", async () => {
    const { user } = renderForm();

    expect(voiceOf("Lisbon trip")).toBeChecked();
    await user.click(voiceOf("Lisbon trip"));

    // Switched off is muted: the flag the server is told is the opposite of
    // the one the reader sees.
    await waitFor(() =>
      expect(setGroupMutedAction).toHaveBeenCalledWith("g1", true),
    );
    expect(voiceOf("Lisbon trip")).not.toBeChecked();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("lets the group speak again from the same switch", async () => {
    const { user } = renderForm();

    await user.click(voiceOf("Lisbon trip"));
    await waitFor(() => expect(voiceOf("Lisbon trip")).toBeEnabled());
    await user.click(voiceOf("Lisbon trip"));

    await waitFor(() =>
      expect(setGroupMutedAction).toHaveBeenLastCalledWith("g1", false),
    );
    expect(voiceOf("Lisbon trip")).toBeChecked();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("puts the switch back when the write is refused, and says so", async () => {
    const { user } = renderForm();
    setGroupMutedAction.mockResolvedValue({ ok: false });

    await user.click(voiceOf("Lisbon trip"));

    await waitFor(() => expect(voiceOf("Lisbon trip")).toBeChecked());
    expect(toastError).toHaveBeenCalledWith(
      "Those settings could not be saved.",
    );
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
