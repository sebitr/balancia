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

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => push(href), refresh: vi.fn() }),
}));
vi.mock("@/modules/join/actions", () => ({
  setJoinLinkExpiryAction: vi.fn(async () => ({
    ok: true,
    data: { expiresAt: null },
  })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// jsdom has no layout, so the sheet's swipe-dismiss listeners have nothing to
// measure; the picker below only needs the content rendered.
vi.mock("@/components/groups/use-detected-timezone", () => ({
  useDetectedTimezone: () => "Europe/Zurich",
}));

function renderSheet() {
  createGroupAction.mockReset();
  push.mockReset();
  createGroupAction.mockResolvedValue({
    ok: true,
    data: {
      groupId: "g1",
      invite: {
        url: "https://balancia.test/join/g/SECRET-TOKEN",
        expiresAt: "2026-08-26T12:00:00.000Z",
      },
    },
  });
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
    // Nobody was asked for this one: the device knows it.
    expect(form.get("timezone")).toBe("Europe/Zurich");
  });

  /**
   * The zone decides which day an expense lands on and nothing else, so it is
   * detected and stated rather than asked — named by its city, which is the
   * half of `Europe/Zurich` a reader recognises.
   */
  it("says which zone it detected instead of asking for one", () => {
    renderSheet();

    expect(
      screen.getByText(/Days end at Zurich time, from this device\./),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /time zone/i }),
    ).not.toBeInTheDocument();
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

  /**
   * A separate group has no base currency — `createGroup` stores null for it
   * — so the row is not shown and the value is not sent. The code is still
   * remembered, because the two modes are one tap apart and a reader who
   * looks at the other one should not come back to a reset currency.
   */
  it("asks for a balance currency only where there is a balance", async () => {
    const { user } = renderSheet();

    await user.type(screen.getByPlaceholderText("Group name"), "Roadtrip");
    expect(screen.getByText("That balance is in")).toBeInTheDocument();

    await user.click(
      screen.getByRole("radio", { name: /A balance per currency/ }),
    );
    expect(screen.queryByText("That balance is in")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create group" }));

    const form = submitted();
    expect(form.get("currencyMode")).toBe("separate");
    expect(form.get("baseCurrency")).toBeNull();
  });

  it("keeps the chosen currency across a look at the other mode", async () => {
    const { user } = renderSheet();

    await user.type(screen.getByPlaceholderText("Group name"), "Roadtrip");
    await user.click(
      screen.getByRole("radio", { name: /A balance per currency/ }),
    );
    await user.click(
      screen.getByRole("radio", { name: /One shared balance/ }),
    );

    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(submitted().get("baseCurrency")).toBe("CHF");
  });

  /**
   * The currency list replaced four chips, so it is now the only way to answer
   * this question — and it answers it inside the same sheet rather than in a
   * second one stacked on top.
   */
  it("chooses a currency in its own view of the same sheet", async () => {
    const { user } = renderSheet();

    await user.type(screen.getByPlaceholderText("Group name"), "Roadtrip");
    await user.click(
      screen.getByRole("button", { name: /That balance is in/ }),
    );

    // One sheet, showing the list where the form was.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const search = screen.getByRole("textbox", { name: "Search a currency" });
    await user.type(search, "japan");
    await user.click(screen.getByRole("button", { name: /^JPY/ }));

    // Selection returns to the form, with the answer on the row.
    expect(screen.getByPlaceholderText("Group name")).toHaveValue("Roadtrip");
    await user.click(screen.getByRole("button", { name: "Create group" }));
    expect(submitted().get("baseCurrency")).toBe("JPY");
  });

  it("hands the link over instead of dropping straight into the group", async () => {
    const { user } = renderSheet();
    await user.type(screen.getByPlaceholderText("Group name"), "Lisbon");
    await user.click(screen.getByRole("button", { name: "Create group" }));

    // The group exists, but the organiser has not been sent anywhere yet:
    // the sheet is now the screen that gives them the link.
    expect(
      await screen.findByRole("heading", { name: "Your group is ready!" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("balancia.test/join/g/SECRET-TOKEN"),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("goes to the group once the handover is done with", async () => {
    const { user, onOpenChange } = renderSheet();
    await user.type(screen.getByPlaceholderText("Group name"), "Lisbon");
    await user.click(screen.getByRole("button", { name: "Create group" }));
    await user.click(await screen.findByRole("button", { name: "Later" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(push).toHaveBeenCalledWith("/groups/g1");
  });

  it("names the people it was given, creator first", async () => {
    const { user } = renderSheet();
    await user.type(screen.getByPlaceholderText("Group name"), "Lisbon");
    await user.type(screen.getByLabelText("Add a person"), "Ana");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(
      await screen.findByText(
        "Share the same link with everyone. Seb and Ana can choose their existing name when they open it.",
      ),
    ).toBeInTheDocument();
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
