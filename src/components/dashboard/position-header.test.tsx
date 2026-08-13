import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { PositionHeader, type PositionHeaderProps } from "./position-header";

/**
 * The headline figure, and the three ways it can be absent: square everywhere,
 * no rate to convert with, and an account holding no balance at all. Only the
 * first is good news, and none of them may render as "0.00".
 */

const TODAY = "2026-08-13";
const NOW = "2026-08-13T12:00:00.000Z";

function renderHeader(overrides: Partial<PositionHeaderProps> = {}) {
  return renderWithIntl(
    <PositionHeader
      net={{ minorUnits: "41260", currency: "EUR" }}
      owedToYou={{ minorUnits: "56040", currency: "EUR" }}
      youOwe={{ minorUnits: "14780", currency: "EUR" }}
      owedGroupCount={3}
      owingGroupCount={2}
      currencyTotals={[]}
      displayCurrency="EUR"
      ratesAsOf={TODAY}
      today={TODAY}
      now={NOW}
      converted
      addExpenseHref="/groups/g1/expenses/new"
      settleUpHref="/groups/g1/balances"
      groupCount={11}
      lastCleared={null}
      {...overrides}
    />,
  );
}

describe("PositionHeader", () => {
  it("leads with the net figure and the direction it points", () => {
    renderHeader();

    expect(screen.getByText("€412.60")).toBeVisible();
    expect(screen.getByText("owed to you")).toBeVisible();
    expect(screen.getByText("€560.40")).toBeVisible();
    expect(screen.getByText("in 3 groups")).toBeVisible();
    expect(screen.getByText("€147.80")).toBeVisible();
    expect(screen.getByText("in 2")).toBeVisible();
  });

  it("puts the primary action in the header, not a bottom bar", () => {
    renderHeader();

    expect(screen.getByRole("link", { name: /Add expense/ })).toHaveAttribute(
      "href",
      "/groups/g1/expenses/new",
    );
    expect(screen.getByRole("link", { name: "Settle up" })).toHaveAttribute(
      "href",
      "/groups/g1/balances",
    );
  });

  it("says which way a negative net points", () => {
    renderHeader({ net: { minorUnits: "-9000", currency: "EUR" } });

    expect(screen.getByText("€90.00")).toBeVisible();
    expect(screen.getByText("you owe")).toBeVisible();
  });

  it("words a zero net, drops the bar, and stops offering to settle", () => {
    renderHeader({
      net: { minorUnits: "0", currency: "EUR" },
      owedToYou: { minorUnits: "0", currency: "EUR" },
      youOwe: { minorUnits: "0", currency: "EUR" },
      owedGroupCount: 0,
      owingGroupCount: 0,
      converted: false,
      ratesAsOf: null,
    });

    expect(screen.getByText("Settled up")).toBeVisible();
    expect(screen.queryByText("€0.00")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Settle up" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Nothing outstanding in 11 groups")).toBeVisible();
  });

  it("dates the calm when something has actually been cleared", () => {
    renderHeader({
      net: { minorUnits: "0", currency: "EUR" },
      owedToYou: { minorUnits: "0", currency: "EUR" },
      youOwe: { minorUnits: "0", currency: "EUR" },
      converted: false,
      ratesAsOf: null,
      lastCleared: { at: "2026-08-10T12:00:00.000Z", groupName: "Chalet" },
    });

    expect(
      screen.getByText(
        "Nothing outstanding in 11 groups · last cleared 3 days ago in Chalet",
      ),
    ).toBeVisible();
  });

  it("treats an account with no balances at all as square, not as broken", () => {
    renderHeader({
      net: null,
      owedToYou: null,
      youOwe: null,
      currencyTotals: [],
      displayCurrency: null,
      converted: false,
      ratesAsOf: null,
    });

    expect(screen.getByText("Settled up")).toBeVisible();
    expect(screen.queryByText(/Rates unavailable/)).not.toBeInTheDocument();
  });

  it("falls back to per-currency totals, and says why, when rates are missing", () => {
    renderHeader({
      net: null,
      owedToYou: null,
      youOwe: null,
      currencyTotals: [
        { currency: "CHF", owedToYou: "21000", youOwe: "0" },
        { currency: "EUR", owedToYou: "1000", youOwe: "400" },
      ],
      converted: false,
    });

    expect(
      screen.getByText("Rates unavailable — showing each group's own currency"),
    ).toBeVisible();
    expect(screen.getByText("CHF 210.00")).toBeVisible();
    expect(screen.queryByText("Settled up")).not.toBeInTheDocument();
  });

  it("dates the footnote when the fixing is not today's", () => {
    renderHeader({ ratesAsOf: "2026-08-11" });

    expect(
      screen.getByText("Converted to EUR at rates from 2026-08-11"),
    ).toBeVisible();
  });
});
