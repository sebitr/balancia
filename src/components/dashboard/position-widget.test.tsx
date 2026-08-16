import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { PositionWidget, type PositionWidgetProps } from "./position-widget";

/**
 * The headline figure, and the three ways it can be absent: square everywhere,
 * no rate to convert with, and an account holding no balance at all. Only the
 * first is good news, and none of them may render as "0.00".
 */

const TODAY = "2026-08-13";
const NOW = "2026-08-13T12:00:00.000Z";

const GROUPS = [
  {
    id: "g1",
    name: "Flatshare",
    icon: null,
    iconColor: null,
    lastActivityAt: "2026-08-11T12:00:00.000Z",
  },
];

function renderWidget(overrides: Partial<PositionWidgetProps> = {}) {
  return renderWithIntl(
    <PositionWidget
      net={{ minorUnits: "41260", currency: "EUR" }}
      owedToYou={{ minorUnits: "56040", currency: "EUR" }}
      youOwe={{ minorUnits: "14780", currency: "EUR" }}
      currencyTotals={[]}
      displayCurrency="EUR"
      ratesAsOf={TODAY}
      today={TODAY}
      now={NOW}
      converted
      groups={GROUPS}
      groupCount={11}
      lastCleared={null}
      {...overrides}
    />,
  );
}

describe("PositionWidget", () => {
  it("leads with the net figure and decomposes it into two totals", () => {
    renderWidget();

    expect(screen.getByText("€413")).toBeVisible();
    expect(screen.getByText("Owed to you")).toBeVisible();
    expect(screen.getByText("€560")).toBeVisible();
    expect(screen.getByText("You owe")).toBeVisible();
    expect(screen.getByText("€148")).toBeVisible();
  });

  it("shows whole units — this is a position, not a statement", () => {
    renderWidget();

    expect(screen.queryByText(/412\.60|560\.40|147\.80/)).toBeNull();
  });

  it("holds both actions, and fills only one of them", () => {
    renderWidget();

    const add = screen.getByRole("button", { name: /Add expense/ });
    const create = screen.getByRole("link", { name: /New group/ });
    expect(add).toHaveAttribute("data-variant", "default");
    expect(create).toHaveAttribute("data-variant", "outline");
    // The create-group sheet is addressable rather than a screen of its own.
    expect(create).toHaveAttribute("href", "?new");
  });

  it("offers no settle shortcut — settling lives inside a group", () => {
    renderWidget();

    expect(screen.queryByText(/Settle up/)).not.toBeInTheDocument();
  });

  it("keeps the conversion disclosure one tap behind the figure", async () => {
    renderWidget();

    // Not a standing footnote: it says nothing on the days nothing moved.
    expect(
      screen.queryByText("Converted to EUR at today's rates"),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /€413/ }));

    expect(
      await screen.findByText("Converted to EUR at today's rates"),
    ).toBeVisible();
  });

  it("dates the disclosure when the rates are not today's", async () => {
    renderWidget({ ratesAsOf: "2026-08-11" });

    await userEvent.click(screen.getByRole("button", { name: /€413/ }));

    expect(
      await screen.findByText("Converted to EUR at rates from 2026-08-11"),
    ).toBeVisible();
  });

  it("says the word rather than showing a zero when everything is square", () => {
    renderWidget({
      net: { minorUnits: "0", currency: "EUR" },
      owedToYou: { minorUnits: "0", currency: "EUR" },
      youOwe: { minorUnits: "0", currency: "EUR" },
    });

    expect(screen.getByText("Settled up")).toBeVisible();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
    // The rule and the totals band have nothing left to decompose.
    expect(screen.queryByText("Owed to you")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing outstanding in 11 groups")).toBeVisible();
  });

  it("falls back to per-currency totals when a rate is missing", () => {
    renderWidget({
      net: null,
      owedToYou: null,
      youOwe: null,
      currencyTotals: [
        { currency: "CHF", owedToYou: "21000", youOwe: "0" },
        { currency: "EUR", owedToYou: "24800", youOwe: "10000" },
      ],
    });

    expect(
      screen.getByText("Rates unavailable — showing each group's own currency"),
    ).toBeVisible();
    // Several honest figures rather than one invented one.
    expect(screen.getByText("CHF 210")).toBeVisible();
    expect(screen.getByText("€248")).toBeVisible();
    expect(screen.getByText("€100")).toBeVisible();
  });

  it("shows neither a figure nor a total for an account holding no balance", () => {
    renderWidget({
      net: null,
      owedToYou: null,
      youOwe: null,
      converted: false,
      currencyTotals: [],
    });

    expect(screen.getByText("Settled up")).toBeVisible();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });

  it("opens the group picker rather than guessing a group", async () => {
    renderWidget();

    await userEvent.click(screen.getByRole("button", { name: /Add expense/ }));

    expect(
      await screen.findByRole("heading", { name: "Add to which group?" }),
    ).toBeVisible();
  });
});
