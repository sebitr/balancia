import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { PositionHeader, type PositionHeaderProps } from "./position-header";

/**
 * The headline figure, and the two ways it can be absent: nothing owed in
 * either direction, and no rate to convert with. Neither may render as "0.00"
 * or as a number that quietly drops a currency.
 */

const TODAY = "2026-08-13";

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
      converted
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

  it("words a zero net rather than printing 0.00", () => {
    renderHeader({
      net: { minorUnits: "0", currency: "EUR" },
      owedToYou: { minorUnits: "0", currency: "EUR" },
      youOwe: { minorUnits: "0", currency: "EUR" },
      owedGroupCount: 0,
      owingGroupCount: 0,
      converted: false,
    });

    expect(screen.getByText("Settled up")).toBeVisible();
    expect(screen.queryByText("€0.00")).not.toBeInTheDocument();
  });

  it("says which way a negative net points", () => {
    renderHeader({ net: { minorUnits: "-9000", currency: "EUR" } });

    expect(screen.getByText("€90.00")).toBeVisible();
    expect(screen.getByText("you owe")).toBeVisible();
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
    expect(screen.getByText("€10.00")).toBeVisible();
  });

  it("dates the footnote when the fixing is not today's", () => {
    renderHeader({ ratesAsOf: "2026-08-11" });

    expect(
      screen.getByText("Converted to EUR at rates from 2026-08-11"),
    ).toBeVisible();
  });

  it("claims no conversion when every group already balanced in the total's currency", () => {
    renderHeader({ converted: false, ratesAsOf: null });

    expect(screen.queryByText(/Converted to/)).not.toBeInTheDocument();
  });
});
