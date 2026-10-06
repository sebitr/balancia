import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { DangerZone } from "./danger-zone";

/**
 * Deleting a group asks for its name, and the asking has to work on a phone.
 *
 * The keyboard capitalised "trip to rome" into "Trip to rome", a trailing
 * space from autocomplete did the same, and either left the button greyed out
 * with nothing on screen saying why. And the dialog remembered what had been
 * typed into it the last time it was open.
 */

const { deleteGroupAction } = vi.hoisted(() => ({
  deleteGroupAction: vi.fn(),
}));

vi.mock("@/modules/groups/actions", () => ({
  deleteGroupAction,
  setGroupArchivedAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderZone(groupName = "trip to rome") {
  deleteGroupAction.mockReset();
  deleteGroupAction.mockResolvedValue(undefined);
  renderWithIntl(
    <DangerZone groupId="g1" groupName={groupName} archived={false} />,
  );
  return userEvent.setup();
}

const confirmField = () => screen.getByLabelText(/to confirm/);
const deleteButton = () =>
  screen.getByRole("button", { name: "Delete permanently" });

describe("the delete confirmation", () => {
  it("asks the keyboard to leave the typed name alone", async () => {
    const user = renderZone();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const field = confirmField();
    expect(field).toHaveAttribute("autocapitalize", "none");
    expect(field).toHaveAttribute("autocorrect", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
  });

  it("accepts the name with the spaces a keyboard adds around it", async () => {
    const user = renderZone();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await user.type(confirmField(), "trip to rom");
    expect(deleteButton()).toBeDisabled();

    await user.type(confirmField(), "e ");
    expect(deleteButton()).toBeEnabled();

    await user.click(deleteButton());
    expect(deleteGroupAction).toHaveBeenCalledWith("g1");
  });

  it("still tells one name from another", async () => {
    const user = renderZone();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await user.type(confirmField(), "Trip to Rome");
    expect(deleteButton()).toBeDisabled();
  });

  it("says it goes for everyone, and where to keep a copy first", async () => {
    const user = renderZone();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      screen.getByText(
        "The group goes for everyone in it, with every expense, repayment, receipt and invitation. This cannot be undone. Export it first if you want a copy.",
      ),
    ).toBeInTheDocument();
  });

  it("forgets what was typed once the dialog is closed", async () => {
    const user = renderZone();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.type(confirmField(), "trip to rome");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirmField()).toHaveValue("");
    expect(deleteButton()).toBeDisabled();
  });
});
