import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { SettledGroups, type SettledGroupView } from "./settled-groups";

/**
 * The quiet end of the list, as rows in the same list as every other section.
 * Search is deliberately not shown until asked for: it is there for an account
 * with dozens of settled groups, and it should not occupy the eye of one that
 * has three.
 */

const NOW = "2026-08-13T12:00:00.000Z";

function group(id: string, name: string): SettledGroupView {
  return {
    id,
    name,
    icon: null,
    iconColor: null,
    participantCount: 2,
    lastActivityAt: "2026-07-23T12:00:00.000Z",
  };
}

const SETTLED = [
  group("a", "trip"),
  group("b", "Sunday football"),
  group("c", "House renovation"),
  group("d", "Bali 2025"),
  group("e", "Book club"),
  group("f", "Weekend in Rome"),
];

const ARCHIVED = [group("x", "Ski weekend 2024"), group("y", "Amsterdam '24")];

describe("SettledGroups", () => {
  it("gives each settled group a row under a counted label", () => {
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} now={NOW} />);

    expect(
      screen.getByRole("heading", { name: "Settled up · 6" }),
    ).toBeVisible();

    const row = screen.getByRole("link", { name: /Book club/ });
    expect(row).toHaveAttribute("href", "/groups/e");
    // No amount to show, so the row carries the word instead — and keeps its
    // right edge aligned with the sections above.
    expect(within(row).getByText("Settled")).toBeVisible();
    expect(within(row).getByText(/2 people/)).toBeVisible();
  });

  it("keeps the search field out of the way until it is asked for", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} now={NOW} />);

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Search your groups" }),
    );

    expect(screen.getByRole("searchbox")).toBeVisible();
  });

  it("filters the rows as you type, case-insensitively", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} now={NOW} />);

    await user.click(
      screen.getByRole("button", { name: "Search your groups" }),
    );
    await user.type(screen.getByRole("searchbox"), "BOOK");

    expect(screen.getByRole("link", { name: /Book club/ })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Bali 2025/ }),
    ).not.toBeInTheDocument();
  });

  it("says so when nothing matches, quoting what was typed", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} now={NOW} />);

    await user.click(
      screen.getByRole("button", { name: "Search your groups" }),
    );
    await user.type(screen.getByRole("searchbox"), "zzz");

    expect(screen.getByText("No group matches “zzz”")).toBeVisible();
  });

  it("closes the archived rows behind one row of the same list", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <SettledGroups settled={[]} archived={ARCHIVED} now={NOW} />,
    );

    expect(
      screen.queryByRole("link", { name: /Ski weekend 2024/ }),
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /2 archived groups/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    const row = screen.getByRole("link", { name: /Ski weekend 2024/ });
    expect(row).toBeVisible();
    expect(within(row).getByText("Archived")).toBeVisible();
    // Archived rows carry no meta line — only the settled ones do.
    expect(within(row).queryByText(/2 people/)).not.toBeInTheDocument();
  });

  it("renders nothing at all when there is neither", () => {
    const { container } = renderWithIntl(
      <SettledGroups settled={[]} archived={[]} now={NOW} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
