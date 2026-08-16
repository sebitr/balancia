import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { GroupSettingsForm } from "./group-settings-form";

/**
 * Editing a group's identity, with no Save button on the card.
 *
 * The save bar is the whole interaction model here: it is the only way to
 * commit, it only exists while something is unsaved, and Discard has to put
 * back everything — including the icon, which is chosen two views away from
 * the field it belongs to. So these check when the bar appears and what the
 * two buttons on it actually do.
 */

const { updateGroupAction } = vi.hoisted(() => ({
  updateGroupAction: vi.fn(),
}));

vi.mock("@/modules/groups/actions", () => ({ updateGroupAction }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderForm() {
  updateGroupAction.mockReset();
  updateGroupAction.mockResolvedValue({ ok: true });
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

/** What the server action was called with, as plain entries. */
function submitted() {
  const formData = updateGroupAction.mock.calls[0]?.[1] as FormData;
  return (key: string) => formData.get(key);
}

const saveBar = () => screen.queryByText("Unsaved changes");

describe("GroupSettingsForm", () => {
  it("keeps the save bar away until something is unsaved", async () => {
    const { user } = renderForm();

    expect(saveBar()).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Name & icon"), "!");

    expect(saveBar()).toBeInTheDocument();
  });

  it("posts every field, the icon included, and lowers the bar", async () => {
    const { user } = renderForm();

    await user.clear(screen.getByLabelText("Name & icon"));
    await user.type(screen.getByLabelText("Name & icon"), "Porto");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateGroupAction).toHaveBeenCalledOnce();
    const field = submitted();
    expect(field("name")).toBe("Porto");
    expect(field("description")).toBe("Four days");
    expect(field("timezone")).toBe("Europe/Zurich");
    // Silence would leave the stored icon alone, so the form always says.
    expect(field("icon")).toBe("plane");
    expect(field("iconColor")).toBe("coral");

    expect(saveBar()).not.toBeInTheDocument();
  });

  it("carries an icon chosen in the sheet, and discards it again", async () => {
    const { user } = renderForm();

    await user.click(
      screen.getByRole("button", { name: "Change the group's icon" }),
    );
    await user.click(screen.getByRole("radio", { name: "tent" }));
    await user.click(screen.getByRole("radio", { name: "blue" }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    // Choosing is a change like any other: nothing is written yet.
    expect(saveBar()).toBeInTheDocument();
    expect(updateGroupAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(saveBar()).not.toBeInTheDocument();

    // Back to the stored pair, which only a save can prove.
    await user.type(screen.getByLabelText("Name & icon"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const field = submitted();
    expect(field("icon")).toBe("plane");
    expect(field("iconColor")).toBe("coral");
    expect(field("name")).toBe("Lisbon trip!");
  });

  it("says what the currency mode is, and offers nothing to change it", () => {
    renderForm();

    expect(screen.getByText("Currency mode")).toBeInTheDocument();
    expect(screen.getByText("Multi currency")).toBeInTheDocument();
    expect(screen.getByText("Fixed")).toBeInTheDocument();
  });
});
