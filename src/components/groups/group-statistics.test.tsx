import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import {
  GroupStatistics,
  type GroupCurrencyStatsView,
  type GroupStatsView,
} from "./group-statistics";

/**
 * The group statistics island, at the level a person uses it.
 *
 * Everything here arrives already computed — the module tests cover the
 * arithmetic. What is worth asserting on this side is that the three
 * switchers actually do something: the range swaps the figures out, the metric
 * re-ranks the people, the netting toggle reaches the total and says so, and a
 * category opens onto its own subcategories rather than onto somebody else's.
 */

function currency(
  overrides: Partial<GroupCurrencyStatsView> = {},
): GroupCurrencyStatsView {
  return {
    currency: "EUR",
    totalSpent: "1248000",
    netTotalSpent: "1171800",
    entryCount: 96,
    medianEntry: "3120",
    perPersonMonth: "20800",
    netPerPersonMonth: "19530",
    flows: {
      spent: "1248000",
      spentCount: 96,
      revenue: "76200",
      revenueCount: 9,
      settled: "234000",
      settledCount: 14,
    },
    buckets: [
      { start: "2026-06-01", amount: "104300", entryCount: 8 },
      { start: "2026-07-01", amount: "98200", entryCount: 7 },
      { start: "2026-08-01", amount: "135192", entryCount: 9 },
    ],
    bucketMean: "104000",
    trendPercent: 42,
    members: [
      {
        participantId: "nora",
        name: "Nora",
        isSelf: true,
        paid: "421400",
        share: "249600",
        net: "171800",
        open: "60000",
      },
      {
        participantId: "ines",
        name: "Inès",
        isSelf: false,
        paid: "300000",
        share: "284800",
        net: "15200",
        open: "-20000",
      },
      {
        participantId: "tomas",
        name: "Tomas",
        isSelf: false,
        paid: "180000",
        share: "204100",
        net: "-24100",
        open: "-40000",
      },
    ],
    categories: [
      {
        category: "home",
        known: true,
        amount: "514200",
        percent: 41.2,
        children: [
          { subcategory: "rent", amount: "267300", percent: 52 },
          { subcategory: "electricity", amount: "71800", percent: 14 },
        ],
        remainder: "175100",
      },
      {
        category: "groceries",
        known: true,
        amount: "350700",
        percent: 28.1,
        children: [
          { subcategory: "supermarket", amount: "350700", percent: 100 },
        ],
        remainder: "0",
      },
      {
        category: "other",
        known: true,
        amount: "32400",
        percent: 2.6,
        children: [],
        remainder: "32400",
      },
    ],
    topThreePercent: 71.9,
    weekdays: [
      { weekday: 1, entryCount: 11, amount: "120000" },
      { weekday: 2, entryCount: 9, amount: "90000" },
      { weekday: 3, entryCount: 12, amount: "130000" },
      { weekday: 4, entryCount: 12, amount: "128000" },
      { weekday: 5, entryCount: 18, amount: "180000" },
      { weekday: 6, entryCount: 23, amount: "299500" },
      { weekday: 7, entryCount: 12, amount: "120500" },
    ],
    ...overrides,
  };
}

function stats(overrides: Partial<GroupStatsView> = {}): GroupStatsView {
  return {
    currencies: ["EUR"],
    firstEntry: "2025-03-01",
    memberCount: 3,
    ranges: [
      { key: "3m", granularity: "week", months: 3, currencies: [currency()] },
      { key: "1y", granularity: "month", months: 12, currencies: [currency()] },
      {
        key: "all",
        granularity: "month",
        months: 18,
        currencies: [currency()],
      },
    ],
    records: [
      {
        currency: "EUR",
        biggestEntry: {
          description: "Sofa",
          category: "home",
          subcategory: "furniture",
          date: "2025-11-14",
          amount: "42890",
          paidBy: "Nora",
        },
        longestOpen: { from: "2026-01-03", to: "2026-02-06", days: 34 },
        longestSquare: { from: "2025-04-02", to: "2025-04-25", days: 23 },
        busiestWeek: { start: "2025-12-08", entryCount: 11, amount: "61240" },
        quietestMonth: { month: "2026-02-01", entryCount: 3, amount: "9620" },
      },
    ],
    ...overrides,
  };
}

describe("the group statistics island", () => {
  it("opens on the year and swaps the figures when the range changes", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <GroupStatistics
        stats={stats({
          ranges: [
            {
              key: "3m",
              granularity: "week",
              months: 3,
              currencies: [currency({ entryCount: 22 })],
            },
            {
              key: "1y",
              granularity: "month",
              months: 12,
              currencies: [currency({ entryCount: 96 })],
            },
            {
              key: "all",
              granularity: "month",
              months: 18,
              currencies: [currency({ entryCount: 148 })],
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole("tab", { name: "1y" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("96")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "3m" }));

    expect(screen.getByText("22")).toBeInTheDocument();
    expect(screen.queryByText("96")).not.toBeInTheDocument();
  });

  it("nets revenue off the total only when asked, and says which it is", async () => {
    const user = userEvent.setup();
    renderWithIntl(<GroupStatistics stats={stats()} />);

    const strip = screen.getByText("Total spent").closest("div");
    expect(
      within(strip as HTMLElement).getByText("€12,480.00"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The total spent above is gross of revenue/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Net of revenue" }));

    expect(
      within(strip as HTMLElement).getByText("€11,718.00"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Revenue is subtracted from the total spent above/),
    ).toBeInTheDocument();
  });

  it("keeps repayments in their own row, out of the spending", () => {
    renderWithIntl(<GroupStatistics stats={stats()} />);

    const settlements = screen.getByText("Settlements").closest("div");
    expect(
      within(settlements as HTMLElement).getByText(
        "14 repayments between members",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Settlements only move money between members and never count as spend/,
      ),
    ).toBeInTheDocument();
  });

  it("re-ranks the members when the metric changes", async () => {
    const user = userEvent.setup();
    renderWithIntl(<GroupStatistics stats={stats()} />);

    const names = () =>
      screen
        .getAllByRole("listitem")
        .map((row) => row.textContent ?? "")
        .filter((text) => /Nora|Inès|Tomas/.test(text));

    // Net: Nora fronted the most, Tomas the least.
    expect(names()[0]).toContain("Nora");
    expect(names()[2]).toContain("Tomas");

    await user.click(screen.getByRole("tab", { name: "Share" }));

    // Share: Inès carried the most.
    expect(names()[0]).toContain("Inès");
    expect(
      screen.getByText(/What the split ratios recorded on each entry made/),
    ).toBeInTheDocument();
  });

  /**
   * A five-figure balance is wider than a fixed amount column, and what a
   * fixed one does with it is put it outside the card and break the smaller
   * amounts over two lines. So the amounts sit on one `auto` track declared
   * on the list, which every row subgrids onto: wide enough for the longest
   * amount in the card, and the same width on all three rows, so the bars
   * still start and end in line.
   */
  it("sizes the amounts on one shared column, not a fixed width", () => {
    renderWithIntl(<GroupStatistics stats={stats()} />);

    const classesOf = (element: Element) => element.getAttribute("class") ?? "";
    const list = screen
      .getAllByRole("list")
      .find((candidate) => within(candidate).queryByText("Nora"));

    expect(list).toBeDefined();
    expect(classesOf(list!)).toMatch(/(^|\s)grid(\s|$)/);
    // Last track `auto`: as wide as the longest amount needs, and no wider.
    expect(classesOf(list!)).toMatch(/grid-cols-\[[^\]]*_auto\]/);
    expect(classesOf(list!)).toMatch(/gap-x-/);

    for (const item of within(list!).getAllByRole("listitem")) {
      expect(classesOf(item)).toContain("grid-cols-subgrid");
      expect(classesOf(item)).toContain("col-span-3");

      // Three cells, none of which fixes a width of its own.
      const cells = [...item.children];
      expect(cells).toHaveLength(3);
      for (const cell of cells) {
        expect(classesOf(cell)).not.toMatch(/(^|\s)w-/);
      }
    }
  });

  it("opens one category at a time, onto its own subcategories", async () => {
    const user = userEvent.setup();
    renderWithIntl(<GroupStatistics stats={stats()} />);

    expect(screen.queryByText("Rent")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Home/ }));
    expect(screen.getByText("Rent")).toBeInTheDocument();
    expect(screen.getByText("Electricity")).toBeInTheDocument();
    // The part of Home nobody filed any further, named rather than dropped.
    expect(
      screen.getByText(/filed under Home with no subcategory/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Groceries/ }));
    expect(screen.queryByText("Rent")).not.toBeInTheDocument();
    expect(screen.getByText("Supermarket")).toBeInTheDocument();
  });

  it("leaves a category with nothing under it inert", () => {
    renderWithIntl(<GroupStatistics stats={stats()} />);
    expect(screen.getByRole("button", { name: /Other/ })).toBeDisabled();
  });

  it("stacks a second currency instead of adding it to the first", () => {
    renderWithIntl(
      <GroupStatistics
        stats={stats({
          currencies: ["EUR", "CHF"],
          ranges: [
            { key: "3m", granularity: "week", months: 3, currencies: [] },
            {
              key: "1y",
              granularity: "month",
              months: 12,
              currencies: [
                currency(),
                currency({ currency: "CHF", entryCount: 7 }),
              ],
            },
            { key: "all", granularity: "month", months: 18, currencies: [] },
          ],
        })}
      />,
    );

    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.getByText("CHF")).toBeInTheDocument();
    expect(screen.getByText("96")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("says so when a window holds nothing", () => {
    renderWithIntl(
      <GroupStatistics
        stats={stats({
          ranges: [
            { key: "3m", granularity: "week", months: 3, currencies: [] },
            { key: "1y", granularity: "month", months: 12, currencies: [] },
            { key: "all", granularity: "month", months: 18, currencies: [] },
          ],
        })}
      />,
    );

    expect(screen.getByText("Nothing to report yet")).toBeInTheDocument();
  });

  it("reports the all-time records under their own heading", () => {
    renderWithIntl(<GroupStatistics stats={stats()} />);

    expect(screen.getByText("Records")).toBeInTheDocument();
    expect(screen.getByText("Biggest single bill")).toBeInTheDocument();
    expect(screen.getByText(/paid by Nora/)).toBeInTheDocument();
    expect(screen.getByText("34 days")).toBeInTheDocument();
    expect(screen.getByText("23 days")).toBeInTheDocument();
  });
});
