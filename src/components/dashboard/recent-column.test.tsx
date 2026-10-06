import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { RecentColumn } from "./recent-column";
import type { RecentRow } from "./recent-rows";

/**
 * Home's right-hand column on a desktop: the head of the inbox, as a glance.
 * Every row opens what the inbox's row opens, and the column ends in the way
 * into the whole inbox.
 */

const NOW = "2026-08-12T12:00:00.000Z";

const ROWS: RecentRow[] = [
  {
    id: "n1",
    type: "expense.created",
    actor: "Amélie",
    groupName: "Lisbon, March",
    sentence: "Amélie added Dinner at Trattoria Il Ponte",
    amount: "€128.40",
    url: "/groups/g1/expenses/e1",
    createdAt: "2026-08-12T10:00:00.000Z",
  },
  {
    id: "n2",
    type: "recurring.generated",
    actor: null,
    groupName: "Flat 4B",
    sentence: "Rent, August was added automatically",
    amount: "€1,450.00",
    url: "/groups/g2/expenses/e2",
    createdAt: "2026-08-09T12:00:00.000Z",
  },
  {
    id: "n3",
    type: "reminder.received",
    actor: "Ravi",
    groupName: "Lisbon, March",
    sentence: "Ravi sent you a reminder",
    amount: null,
    url: "/groups/g1",
    createdAt: "2026-08-12T11:30:00.000Z",
  },
];

describe("RecentColumn", () => {
  it("is a region of its own, named by its heading", () => {
    renderWithIntl(<RecentColumn rows={ROWS} now={NOW} />);

    expect(
      screen.getByRole("complementary", { name: "Recent in your groups" }),
    ).toBeInTheDocument();
  });

  it("is drawn from lg only, so a phone meets no second list of notifications", () => {
    renderWithIntl(<RecentColumn rows={ROWS} now={NOW} />);

    const column = screen.getByRole("complementary");
    expect(column).toHaveClass("hidden");
    expect(column).toHaveClass("lg:flex");
  });

  it("makes each row one link to what the inbox's row opens", () => {
    renderWithIntl(<RecentColumn rows={ROWS} now={NOW} />);

    const dinner = screen.getByRole("link", {
      name: "Amélie added Dinner at Trattoria Il Ponte, €128.40, Lisbon, March, 2h",
    });
    expect(dinner).toHaveAttribute("href", "/groups/g1/expenses/e1");

    // No figure, and nothing left empty in the name for its absence.
    expect(
      screen.getByRole("link", {
        name: "Ravi sent you a reminder, Lisbon, March, 30m",
      }),
    ).toHaveAttribute("href", "/groups/g1");
  });

  it("puts the group and the age under the sentence, and the figure apart", () => {
    renderWithIntl(<RecentColumn rows={ROWS} now={NOW} />);

    const rent = screen.getByRole("link", { name: /Rent, August/ });
    expect(within(rent).getByText("€1,450.00")).toBeInTheDocument();
    expect(within(rent).getByText("3d")).toBeInTheDocument();
    expect(rent).toHaveTextContent("Flat 4B · 3d");
  });

  /** A price is not a balance: no tone, and no word that says which way. */
  it("draws the figure in plain ink", () => {
    renderWithIntl(<RecentColumn rows={ROWS} now={NOW} />);

    const figure = screen.getByText("€128.40");
    expect(figure.className).not.toMatch(/positive|negative|primary/);
  });

  it("ends in the way into the whole inbox", () => {
    renderWithIntl(<RecentColumn rows={ROWS} now={NOW} />);

    expect(
      screen.getByRole("link", { name: "All notifications" }),
    ).toHaveAttribute("href", "/notifications");
  });

  it("says what will turn up here when nothing has yet", () => {
    renderWithIntl(<RecentColumn rows={[]} now={NOW} />);

    expect(
      screen.getByText(
        "When something changes in one of your groups, it turns up here.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "All notifications" }),
    ).toBeInTheDocument();
  });

  it("reads in French", () => {
    renderWithIntl(<RecentColumn rows={[]} now={NOW} />, { locale: "fr" });

    expect(
      screen.getByRole("complementary", { name: "Récemment dans tes groupes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Toutes les notifications" }),
    ).toBeInTheDocument();
  });
});
