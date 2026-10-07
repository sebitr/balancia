import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { FormatPreferencesProvider } from "@/i18n/format-context";
import {
  MemberStatistics,
  type CurrencyStatsView,
  type MemberStatsView,
} from "./member-statistics";

/**
 * The statistics island, at the level a person uses it.
 *
 * Everything here arrives already computed — the module tests cover the
 * arithmetic. What is worth asserting on this side is that the range switcher
 * actually swaps the figures out, that a second currency stacks rather than
 * being folded into the first, and that a window with nothing in it says so
 * instead of drawing an empty chart.
 */

function currency(
  overrides: Partial<CurrencyStatsView> = {},
): CurrencyStatsView {
  return {
    currency: "EUR",
    paid: "421400",
    share: "249600",
    entryCount: 96,
    groupSpent: "1248000",
    payerIndex: 1.69,
    sharePercent: 20,
    rank: 2,
    evenPercent: 20,
    members: [
      { participantId: "ines", name: "Inès", percent: 24.5, isSubject: false },
      { participantId: "nora", name: "Nora", percent: 20, isSubject: true },
      {
        participantId: "tomas",
        name: "Tomas",
        percent: 55.5,
        isSubject: false,
      },
    ],
    buckets: [
      { start: "2026-06-01", paid: "61434", share: "24955" },
      { start: "2026-07-01", paid: "40000", share: "30000" },
      { start: "2026-08-01", paid: "12000", share: "18000" },
    ],
    categories: [
      { category: "groceries", amount: "81120", percent: 32.5 },
      { category: "utilities", amount: "63898", percent: 25.6 },
    ],
    partners: [
      {
        participantId: "ines",
        name: "Inès",
        entryCount: 61,
        amount: "424320",
      },
    ],
    topPartnerPercent: 63,
    ...overrides,
  };
}

function stats(overrides: Partial<MemberStatsView> = {}): MemberStatsView {
  return {
    currencies: ["EUR"],
    firstEntry: "2025-03-01",
    ranges: [
      { key: "3m", granularity: "week", months: 3, currencies: [currency()] },
      {
        key: "1y",
        granularity: "month",
        months: 12,
        currencies: [currency()],
      },
      {
        key: "all",
        granularity: "month",
        months: 18,
        currencies: [currency()],
      },
    ],
    activity: {
      longestRun: 12,
      currentRun: 4,
      days: Array.from({ length: 182 }, (_, index) => ({
        date: `2026-${String(3 + Math.floor(index / 31)).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
        count: index % 4,
        amounts: index % 4 === 0 ? [] : [{ currency: "EUR", amount: "5840" }],
      })),
    },
    records: [
      {
        currency: "EUR",
        biggestBill: {
          description: "Sofa",
          category: "household",
          date: "2025-11-14",
          amount: "42890",
        },
        longestDebt: {
          from: "2026-01-03",
          to: "2026-02-06",
          days: 34,
          owing: true,
        },
        fastestSettle: { hours: 2, on: "2026-02-06" },
        quietestMonth: { month: "2026-02-01", entryCount: 2, amount: "4110" },
      },
    ],
    ...overrides,
  };
}

describe("the statistics island", () => {
  it("opens on the year and swaps every figure when the range changes", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <MemberStatistics
        name="Nora"
        viewingSelf
        stats={stats({
          ranges: [
            {
              key: "3m",
              granularity: "week",
              months: 3,
              currencies: [currency({ entryCount: 22, paid: "128450" })],
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

  /**
   * The range switcher is a real tab list — one Tab stop, the arrows, and a
   * panel named by the chosen range — as the group's own statistics are.
   */
  it("moves between the ranges with the arrow keys", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <MemberStatistics name="Nora" viewingSelf stats={stats()} />,
    );

    const year = screen.getByRole("tab", { name: "1y" });
    expect(year).toHaveAttribute("tabindex", "0");
    year.focus();
    await user.keyboard("{ArrowLeft}");

    const quarter = screen.getByRole("tab", { name: "3m" });
    expect(quarter).toHaveFocus();
    expect(quarter).toHaveAttribute("aria-selected", "true");
    expect(quarter).toHaveAttribute(
      "aria-controls",
      screen.getByRole("tabpanel", { name: "3m" }).id,
    );
  });

  it("speaks to the reader about themselves, and about anyone else in the third person", () => {
    const { unmount } = renderWithIntl(
      <MemberStatistics name="Nora" viewingSelf stats={stats()} />,
    );
    expect(screen.getByText("Your share")).toBeInTheDocument();
    expect(screen.getByText("Where your share went")).toBeInTheDocument();
    unmount();

    renderWithIntl(
      <MemberStatistics name="Nora" viewingSelf={false} stats={stats()} />,
    );
    expect(screen.getByText("Their share")).toBeInTheDocument();
    expect(screen.getByText("Where their share went")).toBeInTheDocument();
  });

  it("stacks a second currency instead of adding it to the first", () => {
    renderWithIntl(
      <MemberStatistics
        name="Nora"
        viewingSelf
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

    expect(screen.getAllByText("Paid vs. share")).toHaveLength(2);
    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.getByText("CHF")).toBeInTheDocument();
  });

  it("says a window is empty rather than drawing an empty chart", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <MemberStatistics
        name="Nora"
        viewingSelf={false}
        stats={stats({
          ranges: [
            { key: "3m", granularity: "week", months: 3, currencies: [] },
            {
              key: "1y",
              granularity: "month",
              months: 12,
              currencies: [currency()],
            },
            {
              key: "all",
              granularity: "month",
              months: 18,
              currencies: [currency()],
            },
          ],
        })}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "3m" }));

    expect(screen.getByText("Nothing in this window")).toBeInTheDocument();
    expect(screen.queryByText("Paid vs. share")).not.toBeInTheDocument();
    // The heatmap and the records outlive the switcher: neither is scoped to
    // a window, so an empty one must not take them off the screen.
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Records")).toBeInTheDocument();
  });

  it("summarises the chart for a reader who cannot see it", () => {
    renderWithIntl(
      <MemberStatistics name="Nora" viewingSelf stats={stats()} />,
    );

    expect(
      screen.getByRole("img", {
        name: /Paid against share over 3 periods: 1.7 times/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "20.0% of what the group spent" }),
    ).toBeInTheDocument();
  });

  /**
   * The three headline figures used to stand side by side as tiles, a third
   * of a phone each, and two of them reached the reader as "CHF 3,066.…".
   * They are rows now, and nothing that holds an amount on this screen may
   * truncate it.
   */
  it("never puts an amount in a box that would cut it short", () => {
    const { container } = renderWithIntl(
      <MemberStatistics
        name="Marta"
        viewingSelf={false}
        stats={stats({
          ranges: [
            { key: "3m", granularity: "week", months: 3, currencies: [] },
            {
              key: "1y",
              granularity: "month",
              months: 12,
              currencies: [
                currency({
                  currency: "CHF",
                  paid: "1234567",
                  share: "306610",
                  groupSpent: "9876543",
                }),
              ],
            },
            { key: "all", granularity: "month", months: 18, currencies: [] },
          ],
        })}
      />,
    );

    expect(screen.getByText("CHF 12,345.67")).toBeVisible();
    expect(screen.getByText("CHF 3,066.10")).toBeVisible();
    // Label and figure on one row, the label first.
    const paid = screen.getByText("Paid").closest("div");
    expect(paid).toHaveTextContent("PaidCHF 12,345.67");

    const amounts = [...container.querySelectorAll("span.tabular-nums")];
    expect(amounts.length).toBeGreaterThan(3);
    for (const amount of amounts) {
      expect(amount.closest(".truncate"), amount.textContent ?? "").toBeNull();
    }
  });

  describe("in plain words", () => {
    it("says how many times their share somebody paid, to one decimal", () => {
      const { unmount } = renderWithIntl(
        <MemberStatistics name="Marta" viewingSelf={false} stats={stats()} />,
      );
      expect(
        screen.getByText("Marta paid 1.7 times their share in this period."),
      ).toBeInTheDocument();
      expect(screen.getByText("1.7×")).toBeInTheDocument();
      expect(screen.queryByText(/window/)).not.toBeInTheDocument();
      unmount();

      renderWithIntl(
        <MemberStatistics name="Nora" viewingSelf stats={stats()} />,
      );
      expect(
        screen.getByText("You paid 1.7 times your share in this period."),
      ).toBeInTheDocument();
      // The flourish about carrying the group was false whenever the ratio
      // was under one, and is gone either way.
      expect(
        screen.queryByText(/carried by your card/),
      ).not.toBeInTheDocument();
    });

    it("names a place in the group instead of a rank and a median", () => {
      const { unmount } = renderWithIntl(
        <MemberStatistics name="Nora" viewingSelf stats={stats()} />,
      );
      expect(
        screen.getByText(
          "2nd largest share of 3 people · an even split is 20.0% each",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/median/)).not.toBeInTheDocument();
      unmount();

      const ranked = (rank: number) =>
        stats({
          ranges: [
            { key: "3m", granularity: "week", months: 3, currencies: [] },
            {
              key: "1y",
              granularity: "month",
              months: 12,
              currencies: [currency({ rank })],
            },
            { key: "all", granularity: "month", months: 18, currencies: [] },
          ],
        });

      const first = renderWithIntl(
        <MemberStatistics name="Nora" viewingSelf stats={ranked(1)} />,
      );
      expect(
        screen.getByText(/^Largest share of 3 people/),
      ).toBeInTheDocument();
      first.unmount();

      renderWithIntl(
        <MemberStatistics name="Nora" viewingSelf stats={ranked(3)} />,
      );
      expect(
        screen.getByText(/^Smallest share of 3 people/),
      ).toBeInTheDocument();
    });

    it("writes the same in French, in the reader's own notation", () => {
      renderWithIntl(
        <FormatPreferencesProvider
          value={{
            dateFormat: "auto",
            numberFormat: "auto",
            formatLocale: "fr",
            timeZone: "UTC",
          }}
        >
          <MemberStatistics name="Marta" viewingSelf={false} stats={stats()} />
        </FormatPreferencesProvider>,
        { locale: "fr" },
      );
      // A decimal comma: the bare `{index}` used to print "1.69" here.
      expect(
        screen.getByText("Marta a payé 1,7 fois sa part sur cette période."),
      ).toBeInTheDocument();
      expect(screen.getByText("1,7×")).toBeInTheDocument();
      // The matcher reads the page with its spaces collapsed, so the
      // non-breaking space before the percent sign is a plain one here.
      expect(
        screen.getByText(
          "2e plus grosse part sur 3 personnes · à parts égales, ce serait 20,0 % par personne",
        ),
      ).toBeInTheDocument();
    });
  });

  it("folds a long tail of categories into one row", () => {
    renderWithIntl(
      <MemberStatistics
        name="Nora"
        viewingSelf
        stats={stats({
          ranges: [
            { key: "3m", granularity: "week", months: 3, currencies: [] },
            {
              key: "1y",
              granularity: "month",
              months: 12,
              currencies: [
                currency({
                  categories: Array.from({ length: 9 }, (_, index) => ({
                    category: null,
                    amount: `${9000 - index * 100}`,
                    percent: 10,
                  })),
                }),
              ],
            },
            { key: "all", granularity: "month", months: 18, currencies: [] },
          ],
        })}
      />,
    );

    const card = screen.getByText("Where your share went").closest("div");
    expect(within(card as HTMLElement).getAllByRole("listitem")).toHaveLength(
      6,
    );
    expect(screen.getByText("Everything else")).toBeInTheDocument();
  });

  /*
   * `--chart-2` is the accent — the "you" series, and this screen's paid
   * series — so the comment above the chart tokens in `globals.css` keeps it
   * off anything categorical. The second category used to be drawn in it.
   */
  it("colours the categories from the categorical chart colours only", () => {
    renderWithIntl(
      <MemberStatistics
        name="Nora"
        viewingSelf
        stats={stats({
          ranges: [
            {
              key: "1y",
              granularity: "month",
              months: 12,
              currencies: [
                currency({
                  categories: Array.from({ length: 6 }, (_, index) => ({
                    category: null,
                    amount: `${9000 - index * 100}`,
                    percent: 10,
                  })),
                }),
              ],
            },
          ],
        })}
      />,
    );

    const card = screen.getByText("Where your share went").closest("div")!;
    const bars = [
      ...card.querySelectorAll<HTMLElement>("li > span > span"),
    ].map((bar) => bar.style.background);

    expect(bars.slice(0, 4)).toEqual([
      "var(--chart-1)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
    ]);
    expect(bars[4]).toBe(bars[5]);
    expect(card.innerHTML).not.toContain("chart-2");
  });
});
