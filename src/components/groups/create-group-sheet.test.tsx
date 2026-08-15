import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { CreateGroupSheet } from "./create-group-sheet";

/**
 * Creating a group, from the point of view of someone in a hurry.
 *
 * The sheet's promise is that a name is the only required answer, so these
 * check what the form actually posts after the shortest path through it, and
 * that the parts which used to be separate screens — the people, the icon —
 * still end up in the same submission.
 */

const { createGroupAction } = vi.hoisted(() => ({
  createGroupAction: vi.fn(),
}));

vi.mock("@/modules/groups/actions", () => ({ createGroupAction }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// jsdom has no layout, so the sheet's swipe-dismiss listeners have nothing to
// measure; the picker below only needs the content rendered.
vi.mock("@/components/groups/use-detected-timezone", () => ({
  useDetectedTimezone: () => "Europe/Zurich",
}));

function renderSheet() {
  createGroupAction.mockReset();
  createGroupAction.mockResolvedValue({ ok: true, data: { groupId: "g1" } });
  const onOpenChange = vi.fn();
  const view = renderWithIntl(
    <CreateGroupSheet
      open
      onOpenChange={onOpenChange}
      defaultName="Seb"
      defaultTimezone="UTC"
      defaultCurrency="CHF"
    />,
  );
  return { ...view, onOpenChange, user: userEvent.setup() };
}

/** What the server action was called with, as plain entries. */
function submitted() {
  const formData = createGroupAction.mock.calls[0]?.[0] as FormData;
  return {
    all: (key: string) => formData.getAll(key).map(String),
    get: (key: string) => formData.get(key),
  };
}

describe("CreateGroupSheet", () => {
  /**
   * The same two limits the add-entry drawer keeps, and for the same reason:
   * this sheet is the other full-height one, with its close button in a header
   * at the top edge. See the note on the drawer's own test.
   */
  it("keeps its header clear of the island, twice over", () => {
    renderSheet();
    const classes = screen.getByRole("dialog").className.split(" ");

    expect(classes.find((name) => name.startsWith("h-["))).toContain(
      "env(safe-area-inset-top)",
    );
    expect(classes.find((name) => name.startsWith("max-h-["))).toContain(
      "env(safe-area-inset-top)",
    );
  });

  it("posts a group once it has a name, defaulting everything else", async () => {
    const { user } = renderSheet();

    await user.type(screen.getByPlaceholderText("Group name"), "Lisbon");
    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(createGroupAction).toHaveBeenCalledOnce();
    const form = submitted();
    expect(form.get("name")).toBe("Lisbon");
    // Converting is the offered default, and the creator is the sole member.
    expect(form.get("currencyMode")).toBe("converted");
    expect(form.get("baseCurrency")).toBe("CHF");
    expect(form.get("ownerDisplayName")).toBe("Seb");
    expect(form.all("participantNames")).toEqual([]);
  });

  it("will not submit until the group has a name", async () => {
    const { user } = renderSheet();

    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(createGroupAction).not.toHaveBeenCalled();
  });

  it("adds people by name, and keeps the creator unremovable", async () => {
    const { user } = renderSheet();

    await user.type(screen.getByPlaceholderText("Group name"), "Flatshare");
    const draft = screen.getByPlaceholderText("Add a person");
    // Enter adds a person rather than submitting the surrounding form.
    await user.type(draft, "Mika{Enter}");
    await user.type(draft, "Sofia{Enter}");

    expect(createGroupAction).not.toHaveBeenCalled();
    // The creator counts: three people are in this group, one of them you.
    expect(screen.getByText("3 people")).toBeInTheDocument();

    const people = screen.getByRole("list");
    expect(
      within(people).queryByRole("button", { name: "Remove Seb" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Mika" }));
    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(submitted().all("participantNames")).toEqual(["Sofia"]);
  });

  it("carries an icon chosen in the second view back into the submission", async () => {
    const { user } = renderSheet();

    await user.type(screen.getByPlaceholderText("Group name"), "Ski");
    await user.click(screen.getByRole("button", { name: "Choose an icon" }));

    // The name field is bound to the same state across both views.
    expect(screen.getByLabelText("Group name")).toHaveValue("Ski");
    await user.click(screen.getByRole("radio", { name: "tent" }));
    await user.click(screen.getByRole("radio", { name: "blue" }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    await user.click(screen.getByRole("button", { name: "Create group" }));

    const form = submitted();
    expect(form.get("icon")).toBe("tent");
    expect(form.get("iconColor")).toBe("blue");
  });

  it("relabels the currency row without losing the chosen currency", async () => {
    const { user } = renderSheet();

    await user.type(screen.getByPlaceholderText("Group name"), "Roadtrip");
    await user.click(screen.getByRole("button", { name: "EUR" }));
    expect(screen.getByText("Base currency")).toBeInTheDocument();

    await user.click(
      screen.getByRole("radio", { name: /Keep currencies separate/ }),
    );

    expect(screen.getByText("Default currency")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create group" }));

    const form = submitted();
    expect(form.get("currencyMode")).toBe("separate");
    expect(form.get("baseCurrency")).toBe("EUR");
  });

  it("keeps the description out of the way until it is asked for", async () => {
    const { user } = renderSheet();

    expect(
      screen.queryByPlaceholderText("Description (optional)"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add a description/ }));
    await user.type(
      screen.getByPlaceholderText("Description (optional)"),
      "Four days",
    );
    await user.type(screen.getByPlaceholderText("Group name"), "Porto");
    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(submitted().get("description")).toBe("Four days");
  });
});
