import { describe, expect, it } from "vitest";
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
