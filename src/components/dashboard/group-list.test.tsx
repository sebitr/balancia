import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { GroupList, type GroupRowView } from "./group-list";

/**
 * The list's own behaviour: the search that appears once scanning by eye stops
 * working, and the redundant cues on a row — an amount is never colour alone.
 */

const NOW = "2026-08-13T12:00:00.000Z";

function row(
  name: string,
  overrides: Partial<GroupRowView> = {},
): GroupRowView {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    memberNames: ["Sofia", "Mika"],
    participantCount: 2,
    lastActivityAt: "2026-08-11T12:00:00.000Z",
    amounts: [{ minorUnits: "-10000", currency: "EUR" }],
    ...overrides,
  };
}

function renderList(props: Partial<Parameters<typeof GroupList>[0]> = {}) {
  return renderWithIntl(
    <GroupList
      youOwe={[]}
      youAreOwed={[]}
      settled={[]}
      archived={[]}
      now={NOW}
      {...props}
    />,
  );
}

/** Nine groups: one more than the threshold the search field appears above. */
function manyGroups(): GroupRowView[] {
  return [
    "Flatshare",
    "Office lunches",
    "Lisbon, March",
    "Chalet",
    "Berlin trip",
    "Sunday football",
    "House renovation",
    "Book club",
    "Weekend in Rome",
  ].map((name) => row(name));
}

describe("GroupList", () => {
  it("does not offer a search box for a list that is still scannable", () => {
    renderList({ youOwe: [row("Flatshare"), row("Chalet")] });

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("offers one past the threshold, and filters as you type", async () => {
    const user = userEvent.setup();
    renderList({ settled: manyGroups() });

    const search = screen.getByRole("searchbox", {
      name: "Search your groups",
    });
    expect(search).toHaveAttribute("placeholder", "Search 9 groups");

    await user.type(search, "ber");

    expect(screen.getByRole("link", { name: /Berlin trip/ })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Chalet/ }),
    ).not.toBeInTheDocument();
  });

  it("matches regardless of case", async () => {
    const user = userEvent.setup();
    renderList({ settled: manyGroups() });

    await user.type(screen.getByRole("searchbox"), "LISBON");

    expect(screen.getByRole("link", { name: /Lisbon, March/ })).toBeVisible();
  });

  it("says so when nothing matches, quoting what was typed", async () => {
    const user = userEvent.setup();
    renderList({ settled: manyGroups() });

    await user.type(screen.getByRole("searchbox"), "xyz");

    expect(screen.getByText("No group matches “xyz”")).toBeVisible();
  });

  it("keeps the direction word for a screen reader where the section label carries it visually", () => {
    renderList({ youOwe: [row("Flatshare")] });

    const link = screen.getByRole("link", { name: /Flatshare/ });
    expect(within(link).getByText("owes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "You owe" })).toBeVisible();
  });

  it("names the people behind the avatar stack", () => {
    renderList({
      youAreOwed: [
        row("Office lunches", {
          memberNames: ["Sofia", "Jonas", "Mika"],
          participantCount: 6,
          amounts: [{ minorUnits: "4780", currency: "EUR" }],
        }),
      ],
    });

    expect(
      screen.getByRole("img", { name: "Sofia, Jonas and 4 others" }),
    ).toBeVisible();
  });

  it("shows a settled group's size and last activity instead of an amount", () => {
    renderList({ settled: [row("Book club", { amounts: [] })] });

    const link = screen.getByRole("link", { name: /Book club/ });
    expect(within(link).getByText(/2 people/)).toBeVisible();
    expect(within(link).getByText("2 days ago")).toBeVisible();
  });

  it("renders archived groups as chips, out of the ranked sections", () => {
    renderList({ archived: [row("Ski weekend 2024", { amounts: [] })] });

    expect(screen.getByRole("heading", { name: /Archived · 1/ })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Ski weekend 2024" }),
    ).toBeVisible();
  });
});
