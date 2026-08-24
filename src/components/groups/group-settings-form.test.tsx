import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { GroupSettingsForm } from "./group-settings-form";

/**
 * Editing a group's identity, which is saved as it is edited.
 *
 * There is no Save button and nothing to press: what is typed goes when the
 * typing stops or the field is left, what is chosen goes as it is chosen, and
 * the icon sheet's choices go together when it closes. So these check *when* a
 * write happens — one per pause rather than one per keystroke — and that the
 * Undo on the confirmation puts back everything the run of edits changed,
 * including the icon, which is chosen two views from the field it belongs to.
 */

const { updateGroupAction, toastUndoable } = vi.hoisted(() => ({
  updateGroupAction: vi.fn(),
  toastUndoable: vi.fn(),
}));

vi.mock("@/modules/groups/actions", () => ({ updateGroupAction }));
// The toast itself is pinned in `sonner.test.tsx`; what matters here is what
// the card hands it, so this stands in for the real one.
vi.mock("@/components/ui/sonner", () => ({ toastUndoable, UNDO_WINDOW: 8000 }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderForm() {
  updateGroupAction.mockReset();
  updateGroupAction.mockResolvedValue({ ok: true });
  toastUndoable.mockReset();
  const view = renderWithIntl(
    <GroupSettingsForm
      groupId="g1"
      name="Lisbon trip"
      description="Four days"
      icon="plane"
      color="coral"
      timezone="Europe/Zurich"
      currencyMode="separate"
      baseCurrency={null}
    />,
  );
  return { ...view, user: userEvent.setup() };
}

/** What one write posted, as plain entries. */
function posted(call = 0) {
  const formData = updateGroupAction.mock.calls[call]?.[1] as FormData;
  return (key: string) => formData.get(key);
}

/** The way back the newest confirmation offered. */
function offeredUndo(): () => void {
  const newest = toastUndoable.mock.calls.at(-1);
  if (!newest) throw new Error("nothing was confirmed");
  return newest[1].onUndo;
}

const nameField = () => screen.getByLabelText("Name & icon");

describe("GroupSettingsForm", () => {
  it("waits for the typing to stop, then writes it once", async () => {
    const { user } = renderForm();

    expect(
      screen.queryByRole("button", { name: /save/i }),
    ).not.toBeInTheDocument();

    await user.type(nameField(), "!!!");
    // Three keystrokes and nothing sent yet: the pause is what sends it.
    expect(updateGroupAction).not.toHaveBeenCalled();

    await waitFor(() => expect(updateGroupAction).toHaveBeenCalledOnce(), {
      timeout: 3000,
    });

    const field = posted();
    expect(field("name")).toBe("Lisbon trip!!!");
    expect(field("description")).toBe("Four days");
    expect(field("timezone")).toBe("Europe/Zurich");
    // Silence would leave the stored icon alone, so the card always says.
    expect(field("icon")).toBe("plane");
    expect(field("iconColor")).toBe("coral");
  });

  it("writes without waiting when the field is left", async () => {
    const { user } = renderForm();

    await user.type(nameField(), "!");
    await user.tab();

    expect(updateGroupAction).toHaveBeenCalledOnce();
    expect(posted()("name")).toBe("Lisbon trip!");

    await waitFor(() =>
      expect(screen.queryByText("Saving…")).not.toBeInTheDocument(),
    );
  });

  it("holds what the icon sheet changes until it closes", async () => {
    const { user } = renderForm();

    await user.click(
      screen.getByRole("button", { name: "Change the group's icon" }),
    );
    await user.click(screen.getByRole("radio", { name: "tent" }));
    await user.click(screen.getByRole("radio", { name: "blue" }));

    // An icon and a colour are one decision, and the sheet is still open.
    expect(updateGroupAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(updateGroupAction).toHaveBeenCalledOnce();
    const field = posted();
    expect(field("icon")).toBe("tent");
    expect(field("iconColor")).toBe("blue");
    expect(field("name")).toBe("Lisbon trip");
  });

  it("writes a timezone as it is chosen", async () => {
    const { user } = renderForm();

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByLabelText("Search timezones"), "Auckland");
    await user.keyboard("{Enter}");

    expect(updateGroupAction).toHaveBeenCalledOnce();
    expect(posted()("timezone")).toBe("Pacific/Auckland");
  });

  it("offers a way back to what the run of edits began with", async () => {
    const { user } = renderForm();

    await user.click(
      screen.getByRole("button", { name: "Change the group's icon" }),
    );
    await user.click(screen.getByRole("radio", { name: "tent" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.type(nameField(), "!");
    await user.tab();

    expect(updateGroupAction).toHaveBeenCalledTimes(2);
    // One toast, replaced, rather than a column of them.
    expect(toastUndoable.mock.calls.map((call) => call[2]?.id)).toEqual([
      "group-settings-g1",
      "group-settings-g1",
    ]);

    await act(async () => offeredUndo()());
    await waitFor(() => expect(updateGroupAction).toHaveBeenCalledTimes(3));

    // Both edits, not just the last one.
    const field = posted(2);
    expect(field("name")).toBe("Lisbon trip");
    expect(field("icon")).toBe("plane");
    expect(nameField()).toHaveValue("Lisbon trip");

    // Undoing is not itself something to undo, so it says nothing.
    expect(toastUndoable).toHaveBeenCalledTimes(2);
  });

  it("says a name is missing rather than writing the group out of its own list", async () => {
    const { user } = renderForm();

    await user.clear(nameField());
    expect(screen.getByText("The group needs a name.")).toBeInTheDocument();

    // Leaving the field would normally be enough to write it.
    await user.tab();
    expect(updateGroupAction).not.toHaveBeenCalled();

    await user.type(nameField(), "Porto");
    await user.tab();

    await waitFor(() => expect(updateGroupAction).toHaveBeenCalledOnce());
    expect(posted()("name")).toBe("Porto");
    expect(
      screen.queryByText("The group needs a name."),
    ).not.toBeInTheDocument();
  });

  it("says what the currency mode is, and offers nothing to change it", () => {
    renderForm();

    const title = screen.getByText("Currency mode: Multi currency");

    expect(title.nextElementSibling).toHaveTextContent("Fixed");
    expect(
      screen.getByText("Each currency keeps its own balance.", {
        exact: false,
      }),
    ).toBeInTheDocument();
  });
});
