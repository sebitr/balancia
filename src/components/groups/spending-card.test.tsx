import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { SpendingPeriodView } from "./spending-card";

/**
 * The statistics row at the foot of the spending card.
 *
 * Its title and caption used to be one line joined by a middot, and are now
 * stacked. Stacking is a visual separator only: jsdom — and a screen reader —
 * concatenates the two spans into "StatisticsPer person and per category"
 * unless the link states its own name, so that name is what these assert on.
 */

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    transitionTypes,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    transitionTypes?: string[];
  }) => (
    <a href={href} data-transition={transitionTypes?.join(" ")} {...rest}>
      {children}
    </a>
  ),
}));

const { SpendingCard } = await import("./spending-card");

const THIS_MONTH: SpendingPeriodView = {
  key: "thisMonth",
  stats: [
    {
      currency: "CHF",
      groupSpent: "115900",
      youPaid: "36400",
      yourShare: "38634",
      categories: [
        { category: "groceries", amount: "80000" },
        { category: "transport", amount: "35900" },
      ],
    },
  ],
};

/** The trip the desktop overview was drawn against, all time, in euros. */
const LISBON_EUR: SpendingPeriodView["stats"][number] = {
  currency: "EUR",
  groupSpent: "141100",
  youPaid: "58660",
  yourShare: "33860",
  categories: [
    { category: "lodging", amount: "48500" },
    { category: "activities", amount: "30600" },
    { category: "groceries", amount: "24120" },
    { category: "restaurants", amount: "20580" },
    { category: "transport", amount: "17300" },
  ],
};

describe("the spending card's statistics row", () => {
  it("names itself with both lines, not with them run together", () => {
    renderWithIntl(
      <SpendingCard groupId="g1" periods={[THIS_MONTH]} compact={false} />,
    );

    expect(
      screen.getByRole("link", {
        name: "Statistics · Per person and per category",
      }),
    ).toHaveAttribute("href", "/groups/g1/stats");
  });

  it("carries the caption in French too", () => {
    renderWithIntl(
      <SpendingCard groupId="g1" periods={[THIS_MONTH]} compact={false} />,
      { locale: "fr" },
    );

    expect(
      screen.getByRole("link", {
        name: "Statistiques · Par personne et par catégorie",
      }),
    ).toBeInTheDocument();
  });

  it("states the reader's share as a share, not as a bare percentage", () => {
    renderWithIntl(
      <SpendingCard groupId="g1" periods={[THIS_MONTH]} compact={false} />,
      { locale: "fr" },
    );

    // 386.34 of 1159.00 is 33%.
    expect(screen.getByText("Ta part : 33 %")).toBeInTheDocument();
  });
});

/**
 * What the period's spending went on, which the card says from `lg` up.
 *
 * jsdom has no viewport, so "from `lg` up" is held where it is decided — the
 * block is `display: none` until `lg:flex` — and what it says is held on the
 * rows themselves.
 */
describe("the spending card's categories", () => {
  const ALL_TIME = (
    stats: SpendingPeriodView["stats"],
  ): SpendingPeriodView => ({ key: "allTime", stats });

  // "Categories", or "Catégories" in the one test that reads French.
  const block = () =>
    screen.getByRole("heading", { name: /^Cat[eé]gories/ }).parentElement!;

  const rows = () =>
    within(block())
      .getAllByRole("listitem")
      .map((row) => row.textContent?.replace(/ /g, " "));

  it("are drawn from lg up and not below it", () => {
    renderWithIntl(
      <SpendingCard
        groupId="g1"
        periods={[ALL_TIME([LISBON_EUR])]}
        compact={false}
      />,
    );

    expect(block()).toHaveClass("hidden", "lg:flex");
  });

  it("name each category in the app's words, largest first, with its amount", () => {
    renderWithIntl(
      <SpendingCard
        groupId="g1"
        periods={[ALL_TIME([LISBON_EUR])]}
        compact={false}
      />,
    );

    expect(rows()).toEqual([
      "Lodging€485.00",
      "Activities€306.00",
      "Groceries€241.20",
      "Restaurants€205.80",
      "Transport€173.00",
    ]);
  });

  it("fold everything past the fifth row into one, summed", () => {
    renderWithIntl(
      <SpendingCard
        groupId="g1"
        periods={[
          ALL_TIME([
            {
              ...LISBON_EUR,
              categories: [
                ...LISBON_EUR.categories.slice(0, 4),
                { category: "transport", amount: "12000" },
                { category: null, amount: "3300" },
                { category: "Bar tab", amount: "2000" },
              ],
            },
          ]),
        ]}
        compact={false}
      />,
    );

    expect(rows()).toEqual([
      "Lodging€485.00",
      "Activities€306.00",
      "Groceries€241.20",
      "Restaurants€205.80",
      "Everything else€173.00",
    ]);
  });

  it("say what nobody filed, and keep an imported label as it was written", () => {
    renderWithIntl(
      <SpendingCard
        groupId="g1"
        periods={[
          ALL_TIME([
            {
              ...LISBON_EUR,
              categories: [
                { category: "Bar tab", amount: "5000" },
                { category: null, amount: "2000" },
              ],
            },
          ]),
        ]}
        compact={false}
      />,
      { locale: "fr" },
    );

    // The words are French; the figures follow the number format, which the
    // helper leaves at its default.
    expect(rows()).toEqual(["Bar tab€50.00", "Sans catégorie€20.00"]);
  });

  it("never draw a bar or a figure in the accent or a money colour", () => {
    renderWithIntl(
      <SpendingCard
        groupId="g1"
        periods={[ALL_TIME([LISBON_EUR])]}
        compact={false}
      />,
    );

    const painted = within(block())
      .getAllByRole("listitem")
      .flatMap((row) => [...row.querySelectorAll<HTMLElement>("*")]);
    for (const element of painted) {
      expect(element.getAttribute("style") ?? "").not.toMatch(
        /--(primary|chart-2|positive|negative|payer)\b/,
      );
      expect(element.className).not.toMatch(
        /\b(text|bg)-(primary|positive|negative|payer)/,
      );
    }
  });

  it("give a group with several currencies one block each, headed by its code", () => {
    renderWithIntl(
      <SpendingCard
        groupId="g1"
        periods={[
          ALL_TIME([
            {
              currency: "CHF",
              groupSpent: "9600",
              youPaid: "0",
              yourShare: "1600",
              categories: [{ category: "transport", amount: "9600" }],
            },
            LISBON_EUR,
          ]),
        ]}
        compact
      />,
    );

    const headings = screen.getAllByRole("heading", { name: /^Categories/ });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "CategoriesCHF",
      "CategoriesEUR",
    ]);
    expect(
      within(headings[0].parentElement!)
        .getAllByRole("listitem")
        .map((row) => row.textContent?.replace(/ /g, " ")),
    ).toEqual(["TransportCHF 96.00"]);
  });

  it("leave out a currency with nothing spent in the period", () => {
    renderWithIntl(
      <SpendingCard
        groupId="g1"
        periods={[
          ALL_TIME([
            {
              currency: "CHF",
              groupSpent: "0",
              youPaid: "0",
              yourShare: "0",
              categories: [],
            },
            LISBON_EUR,
          ]),
        ]}
        compact
      />,
    );

    expect(
      screen
        .getAllByRole("heading", { name: /^Categories/ })
        .map((heading) => heading.textContent),
    ).toEqual(["CategoriesEUR"]);
  });
});
