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
/**
 * The device's zone, which a test may withhold and then deliver — the way a
 * server render has none and hydration brings it.
 */
const device = vi.hoisted(() => ({ zone: "Europe/Zurich" as string | null }));
vi.mock("@/components/groups/use-detected-timezone", () => ({
  useDetectedTimezone: () => device.zone,
}));

function renderSheet({
  preferredCurrency = null,
  zone = "Europe/Zurich",
}: { preferredCurrency?: string | null; zone?: string | null } = {}) {
  device.zone = zone;
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
  // A fresh element each time: React skips one it has already rendered.
  const sheet = () => (
    <CreateGroupSheet
      open
      onOpenChange={onOpenChange}
      defaultName="Seb"
      defaultTimezone="UTC"
      preferredCurrency={preferredCurrency}
    />
  );
  const view = renderWithIntl(sheet());
  return {
    ...view,
    onOpenChange,
    user: userEvent.setup(),
    /** Renders again as it is, for a zone that has changed underneath. */
    redraw: () => view.rerender(sheet()),
  };
}

/** The submit button, whichever currency it is naming. */
function createButton() {
  return screen.getByRole("button", { name: /^Create group/ });
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
    await user.click(createButton());

    expect(createGroupAction).toHaveBeenCalledOnce();
    const form = submitted();
    expect(form.get("name")).toBe("Lisbon");
    // Converting is the offered default, into what is paid where the device
    // is — no preference was stated — and the creator is the sole member.
    expect(form.get("currencyMode")).toBe("converted");
    expect(form.get("baseCurrency")).toBe("CHF");
    expect(form.get("ownerDisplayName")).toBe("Seb");
    expect(form.all("participantNames")).toEqual([]);
    // Nobody was asked for this one: the device knows it.
    expect(form.get("timezone")).toBe("Europe/Zurich");
  });

  /**
   * The zone decides days and times — what counts as today, when a recurring
   * expense is added, what Activity shows — and the device already knows it,
   * so it is detected and stated rather than asked: named by its city, which
   * is the half of `Europe/Zurich` a reader recognises, and saying what it
   * decides the way the group's settings do.
   */
  it("says which zone it detected instead of asking for one", () => {
    renderSheet();

    expect(
      screen.getByText(
        /^Zurich time, from this device, decides what counts as today for new entries, when recurring expenses are added and the times shown in Activity\. Change it in the group’s settings\.$/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /time zone/i }),
    ).not.toBeInTheDocument();
  });

  /**
   * The currency cannot be changed once the group exists, so it is the one
   * answer that has to be on screen when the button is pressed. It sat below
   * the people, and three names were enough to push it under the footer.
   */
  it("asks the currency straight after the name, ahead of the people", () => {
    renderSheet();

    const name = screen.getByPlaceholderText("Group name");
    const modes = screen.getByRole("radiogroup", {
      name: "If someone pays in another currency",
    });
    const balance = screen.getByRole("button", { name: /That balance is in/ });
    const fixed = screen.getByText("Fixed once the group exists.");
    const people = screen.getByText("Participants");

    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(name, modes)).toBe(true);
    expect(follows(modes, balance)).toBe(true);
    // The note stays with the answer it is about, before anybody is named.
    expect(follows(balance, fixed)).toBe(true);
    expect(follows(fixed, people)).toBe(true);
  });

  it("names the currency it will fix on the button that fixes it", async () => {
    const { user } = renderSheet();

    expect(
      screen.getByRole("button", { name: "Create group in CHF" }),
    ).toBeInTheDocument();

    // A balance per currency has no one currency to name.
    await user.click(
      screen.getByRole("radio", { name: /A balance per currency/ }),
    );
    expect(
      screen.getByRole("button", { name: "Create group" }),
    ).toBeInTheDocument();
  });

  it("names it in French too", () => {
    device.zone = "Europe/Zurich";
    renderWithIntl(
      <CreateGroupSheet
        open
        onOpenChange={vi.fn()}
        defaultName="Seb"
        defaultTimezone="UTC"
        preferredCurrency={null}
      />,
      { locale: "fr" },
    );

    expect(
      screen.getByRole("button", { name: "Créer le groupe en CHF" }),
    ).toBeInTheDocument();
  });

  it("lets a stated preference beat where the device is", async () => {
    const { user } = renderSheet({ preferredCurrency: "PLN" });

    await user.type(screen.getByPlaceholderText("Group name"), "Kraków");
    await user.click(
      screen.getByRole("button", { name: "Create group in PLN" }),
    );

    expect(submitted().get("baseCurrency")).toBe("PLN");
  });

  it("lets a currency picked by hand beat both", async () => {
    const { user } = renderSheet({ preferredCurrency: "PLN" });

    await user.type(screen.getByPlaceholderText("Group name"), "Tokyo");
    await user.click(
      screen.getByRole("button", { name: /That balance is in/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Search a currency" }),
      "japan",
    );
    await user.click(screen.getByRole("button", { name: /^JPY/ }));
    await user.click(
      screen.getByRole("button", { name: "Create group in JPY" }),
    );

    expect(submitted().get("baseCurrency")).toBe("JPY");
  });

  /**
   * The device answers at hydration, after the first render. Until somebody
   * picks, its answer replaces the constant; after they have, it changes
   * nothing.
   */
  it("takes the device's answer when it arrives late, but never over a pick", async () => {
    const { user, redraw } = renderSheet({ zone: null });

    // Nothing to go on yet: the constant.
    expect(
      screen.getByRole("button", { name: "Create group in EUR" }),
    ).toBeInTheDocument();

    device.zone = "Europe/Zurich";
    redraw();
    expect(
      screen.getByRole("button", { name: "Create group in CHF" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /That balance is in/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Search a currency" }),
      "japan",
    );
    await user.click(screen.getByRole("button", { name: /^JPY/ }));

    device.zone = "Europe/London";
    redraw();
    expect(
      screen.getByRole("button", { name: "Create group in JPY" }),
    ).toBeInTheDocument();
  });

  it("will not submit until the group has a name", async () => {
    const { user } = renderSheet();

    await user.click(createButton());

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
    await user.click(createButton());

    expect(submitted().all("participantNames")).toEqual(["Sofia"]);
  });

  it("carries an icon chosen in the second view back into the submission", async () => {
    const { user } = renderSheet();

    await user.type(screen.getByPlaceholderText("Group name"), "Ski");
    await user.click(screen.getByRole("button", { name: "Choose an icon" }));

    // The name field is bound to the same state across both views.
    expect(screen.getByLabelText("Group name")).toHaveValue("Ski");
    await user.click(screen.getByRole("radio", { name: "Tent" }));
    await user.click(screen.getByRole("radio", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    await user.click(createButton());

    const form = submitted();
    expect(form.get("icon")).toBe("tent");
    expect(form.get("iconColor")).toBe("blue");
  });

  /**
   * Each tile is named in the reader's language. They were named by their
   * slugs, so a French screen reader read "cart" in English for a trolley.
   */
  it("names the icons and colours in the reader's language", async () => {
    createGroupAction.mockReset();
    const user = userEvent.setup();
    renderWithIntl(
      <CreateGroupSheet
        open
        onOpenChange={vi.fn()}
        defaultName="Seb"
        defaultTimezone="UTC"
        preferredCurrency="CHF"
      />,
      { locale: "fr" },
    );

    await user.click(screen.getByRole("button", { name: "Choisir une icône" }));

    expect(screen.getByRole("radio", { name: "Chariot" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Prune" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "cart" })).toBeNull();
  });

  /**
   * The picker's two groups are one Tab stop each, and the arrows move
   * through them — up and down by a row in the five-wide icon grid.
   */
  it("moves through the icons and colours with the arrow keys", async () => {
    const { user } = renderSheet();

    await user.click(screen.getByRole("button", { name: "Choose an icon" }));

    const coral = screen.getByRole("radio", { name: "Coral" });
    expect(coral).toHaveAttribute("tabindex", "0");
    coral.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Emerald" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Emerald" })).toBeChecked();

    // Nothing is chosen yet, so the grid is entered at its first icon.
    const plane = screen.getByRole("radio", { name: "Plane" });
    expect(plane).toHaveAttribute("tabindex", "0");
    plane.focus();
    await user.keyboard("{ArrowDown}");
    // Five to a row: straight down from the plane is the sixth icon.
    expect(
      screen.getByRole("radio", { name: "Shopping trolley" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("radio", { name: "Shopping trolley" }),
    ).toBeChecked();
  });

  it("moves between the two currency answers with the arrow keys", async () => {
    const { user } = renderSheet();

    const shared = screen.getByRole("radio", { name: /One shared balance/ });
    expect(shared).toBeChecked();
    shared.focus();
    await user.keyboard("{ArrowDown}");

    const separate = screen.getByRole("radio", {
      name: /A balance per currency/,
    });
    expect(separate).toHaveFocus();
    expect(separate).toBeChecked();
    expect(
      screen.getByRole("radiogroup", {
        name: "If someone pays in another currency",
      }),
    ).toContainElement(separate);
  });

  /** The add-a-person row is the field's edge, so the row shows its focus. */
  it("rings the add-a-person row while its field has focus", () => {
    renderSheet();

    const row = screen.getByRole("textbox", {
      name: "Add a person",
    }).parentElement;
    expect(row?.className).toContain("has-[input:focus-visible]:ring-3");
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

    await user.click(createButton());

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
    await user.click(screen.getByRole("radio", { name: /One shared balance/ }));

    await user.click(createButton());

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
    await user.click(createButton());
    expect(submitted().get("baseCurrency")).toBe("JPY");
  });

  it("hands the link over instead of dropping straight into the group", async () => {
    const { user } = renderSheet();
    await user.type(screen.getByPlaceholderText("Group name"), "Lisbon");
    await user.click(createButton());

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
    await user.click(createButton());
    await user.click(await screen.findByRole("button", { name: "Later" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(push).toHaveBeenCalledWith("/groups/g1");
  });

  it("names the people it was given, creator first", async () => {
    const { user } = renderSheet();
    await user.type(screen.getByPlaceholderText("Group name"), "Lisbon");
    await user.type(screen.getByLabelText("Add a person"), "Ana");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(createButton());

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
    await user.click(createButton());

    expect(submitted().get("description")).toBe("Four days");
  });
});
