import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { AddExpenseSheet, type PickableGroup } from "./add-expense-sheet";

/**
 * Which group the expense goes into, asked before the form. Unfiltered the
 * sheet offers only the few most recently touched — the answer nearly always
 * — and a query reaches the rest.
 */

const NOW = "2026-08-13T12:00:00.000Z";

const NAMES = [
  "Lisbon, March",
  "Chalet",
  "Office lunches",
  "Flatshare",
  "Berlin trip",
  "Book club",
  "Sunday football",
];

const GROUPS: PickableGroup[] = NAMES.map((name, index) => ({
  id: `g${index}`,
  name,
  icon: null,
  iconColor: null,
  lastActivityAt: new Date(
    Date.parse(NOW) - (index + 1) * 3_600_000,
  ).toISOString(),
}));

function renderSheet() {
  return renderWithIntl(
    <AddExpenseSheet open onOpenChange={() => {}} groups={GROUPS} now={NOW} />,
  );
}

describe("AddExpenseSheet", () => {
  it("offers the five most recently active groups before anything is typed", () => {
    renderSheet();

    expect(screen.getByText("Most recent first")).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.getByRole("link", { name: /Lisbon, March/ })).toBeVisible();
    expect(screen.queryByText("Book club")).not.toBeInTheDocument();
  });

  it("routes a pick to that group's own add-expense form", () => {
    renderSheet();

    expect(screen.getByRole("link", { name: /Chalet/ })).toHaveAttribute(
      "href",
      "/groups/g1/expenses/new",
    );
  });

  it("searches every group once there is a query, and counts the matches", async () => {
    renderSheet();

    await userEvent.type(screen.getByRole("searchbox"), "club");

    expect(screen.getByRole("link", { name: /Book club/ })).toHaveAttribute(
      "href",
      "/groups/g5/expenses/new",
    );
    expect(screen.getByText("1 of 7 groups")).toBeVisible();
  });

  it("is case-insensitive", async () => {
    renderSheet();

    await userEvent.type(screen.getByRole("searchbox"), "FLATSHARE");

    expect(screen.getByRole("link", { name: /Flatshare/ })).toBeVisible();
  });

  it("says so when nothing matches", async () => {
    renderSheet();

    await userEvent.type(screen.getByRole("searchbox"), "xyz");

    expect(screen.getByText("No group matches “xyz”")).toBeVisible();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("opening", () => {
  /**
   * The sheet opens on the list, not in the field above it. Most people have a
   * handful of groups and tap the one they mean; raising a keyboard over that
   * list makes the common answer the one you have to dismiss something to
   * reach.
   */
  it("does not put the keyboard up before anybody has asked to search", async () => {
    renderSheet();

    const search = screen.getByRole("searchbox");
    expect(search).not.toHaveFocus();
    // Still inside the dialog, or nothing can be tabbed and Escape is dead.
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    );

    // And it is a search field the moment somebody wants one.
    await userEvent.type(search, "berlin");
    expect(search).toHaveFocus();
    expect(screen.getByRole("link", { name: /Berlin trip/ })).toBeVisible();
  });
});

/**
 * On a desk the chooser is a small dialog worked from the keys as well as the
 * pointer: 1 to 9 pick the group beside that number, the arrows walk the rows,
 * and each row says how many people are in the group as well as when it last
 * moved.
 */
describe("on a desk", () => {
  let matchMedia: typeof window.matchMedia;

  beforeEach(() => {
    matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(min-width: 64rem)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = matchMedia;
  });

  const COUNTED = GROUPS.map((group, index) => ({
    ...group,
    participantCount: index + 2,
  }));

  function renderDesk(onOpenChange = vi.fn()) {
    renderWithIntl(
      <AddExpenseSheet
        open
        onOpenChange={onOpenChange}
        groups={COUNTED}
        now={NOW}
      />,
    );
    return onOpenChange;
  }

  it("says how many people each group has, and numbers the rows", () => {
    renderDesk();

    const lisbon = screen.getByRole("link", { name: /Lisbon, March/ });
    expect(lisbon).toHaveTextContent("2 people · 1 hour ago");
    expect(lisbon).toHaveAttribute("aria-keyshortcuts", "1");
    expect(screen.getByRole("link", { name: /Chalet/ })).toHaveAttribute(
      "aria-keyshortcuts",
      "2",
    );
    expect(screen.getByText("5 of 7 groups")).toBeInTheDocument();
  });

  it("picks the group beside the number pressed", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderDesk();
    let followed = "";
    const chalet = screen.getByRole("link", { name: /Chalet/ });
    chalet.addEventListener("click", (event) => {
      followed = (event.currentTarget as HTMLAnchorElement).pathname;
      event.preventDefault();
    });

    await user.keyboard("2");

    expect(followed).toBe("/groups/g1/expenses/new");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("walks the rows with the arrows, round from the end", async () => {
    const user = userEvent.setup();
    renderDesk();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: /Lisbon, March/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: /Chalet/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("link", { name: /Berlin trip/ })).toHaveFocus();
  });

  it("leaves a digit typed into the search where it was typed", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderDesk();

    await user.type(screen.getByRole("searchbox"), "4");

    expect(screen.getByRole("searchbox")).toHaveValue("4");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
