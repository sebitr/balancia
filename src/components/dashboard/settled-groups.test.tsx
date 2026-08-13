import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { SettledGroups } from "./settled-groups";

/**
 * The quiet end of the list. Search is deliberately not shown until asked for:
 * it is there for an account with dozens of settled groups, and it should not
 * occupy the eye of one that has three.
 */

const SETTLED = [
  { id: "a", name: "trip" },
  { id: "b", name: "Sunday football" },
  { id: "c", name: "House renovation" },
  { id: "d", name: "Bali 2025" },
  { id: "e", name: "Book club" },
  { id: "f", name: "Weekend in Rome" },
];

const ARCHIVED = [
  { id: "x", name: "Ski weekend 2024" },
  { id: "y", name: "Amsterdam '24" },
];

describe("SettledGroups", () => {
  it("shows settled groups as chips under a counted label", () => {
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} />);

    expect(
      screen.getByRole("heading", { name: "Settled up · 6" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Book club" })).toHaveAttribute(
      "href",
      "/groups/e",
    );
  });

  it("keeps the search field out of the way until it is asked for", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} />);

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByRole("searchbox")).toBeVisible();
  });

  it("filters the chips as you type, case-insensitively", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByRole("searchbox"), "BOOK");

    expect(screen.getByRole("link", { name: "Book club" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Bali 2025" }),
    ).not.toBeInTheDocument();
  });

  it("says so when nothing matches, quoting what was typed", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} />);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByRole("searchbox"), "zzz");

    expect(screen.getByText("No group matches “zzz”")).toBeVisible();
  });

  it("hides archived groups behind one link rather than listing them", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettledGroups settled={[]} archived={ARCHIVED} />);

    expect(
      screen.queryByRole("link", { name: "Ski weekend 2024" }),
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "2 archived groups" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(
      screen.getByRole("link", { name: "Ski weekend 2024" }),
    ).toBeVisible();
  });

  it("renders nothing at all when there is neither", () => {
    const { container } = renderWithIntl(
      <SettledGroups settled={[]} archived={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
