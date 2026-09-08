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

  it("names the figure rather than leaving the number to speak for itself", () => {
    renderWidget();

    expect(screen.getByRole("region", { name: "Total balance" })).toBeVisible();
    expect(screen.getByText("Total balance")).toBeVisible();
  });

  it("leaves the totals unsigned — their column labels carry direction", () => {
    renderWidget();

    expect(screen.queryByText("+")).toBeNull();
    expect(screen.queryByText("−")).toBeNull();
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

  /**
   * Four currencies used to arrive as four display-size figures stacked on top
   * of one another, and the list of groups they came from was pushed off the
   * screen. One of them leads now; the rest are rows.
   */
  const NO_RATE = {
    net: null,
    owedToYou: null,
    youOwe: null,
    // CHF 2,161.00 owed, $180.00 owed, €632.00 owing.
    currencyTotals: [
      { currency: "CHF", owedToYou: "0", youOwe: "216100" },
      { currency: "EUR", owedToYou: "63200", youOwe: "0" },
      { currency: "USD", owedToYou: "0", youOwe: "18000" },
    ],
  } satisfies Partial<PositionWidgetProps>;

  it("leads on the largest debt and keeps the rest as rows", () => {
    renderWidget(NO_RATE);

    // The one figure sized like an answer, and the only one the disclosure
    // sits behind.
    const lead = screen.getByRole("button", { name: /CHF\s*2,161\.00/ });
    expect(lead).toBeVisible();
    expect(screen.getByText("$180.00")).toBeVisible();
    expect(screen.getByText("€632.00")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /180\.00|632\.00/ }),
    ).toBeNull();
  });

  /** A debt is the fact the reader can act on, so it goes first. */
  it("ranks what is owed before what is owing, largest first", () => {
    renderWidget(NO_RATE);

    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toEqual(["you owe$180.00", "you are owed€632.00"]);
  });

  /**
   * Minor units are not a common unit: ¥4,500 is "4500" and €50.00 is "5000",
   * so comparing them as stored would put the smaller figure on top.
   */
  it("ranks currencies by the figure on the screen, not by its minor units", () => {
    renderWidget({
      net: null,
      owedToYou: null,
      youOwe: null,
      currencyTotals: [
        { currency: "EUR", owedToYou: "0", youOwe: "5000" },
        { currency: "JPY", owedToYou: "0", youOwe: "4500" },
      ],
    });

    expect(screen.getByRole("button", { name: /¥4,500/ })).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("€50.00")).toBeVisible();
  });

  it("counts the currencies rather than adding them up", () => {
    renderWidget(NO_RATE);

    expect(screen.getByText("3 currencies")).toBeVisible();
  });

  it("keeps the reason for the per-currency figures one tap behind them", async () => {
    renderWidget(NO_RATE);

    await userEvent.click(
      screen.getByRole("button", { name: /CHF\s*2,161\.00/ }),
    );

    expect(
      await screen.findByText(
        "Shown per currency. There is no exchange rate to combine them into one total.",
      ),
    ).toBeVisible();
  });

  /**
   * Colour is never the only signal. The word used to be `sr-only` under a
   * signed figure; it is on the screen now, beside an arrow, so the figures
   * themselves carry no sign.
   */
  it("says each direction in a word, and signs no figure", () => {
    renderWidget(NO_RATE);

    // Twice: once as the headline's caption, once on the dollar row.
    expect(screen.getAllByText("you owe")).toHaveLength(2);
    expect(screen.getAllByText("you are owed")).toHaveLength(1);
    expect(screen.queryByText(/^[+−]/)).toBeNull();
  });

  /** A currency that has come out level is not a position to lead with. */
  it("leaves a currency that nets to zero out of the header", () => {
    renderWidget({
      net: null,
      owedToYou: null,
      youOwe: null,
      currencyTotals: [
        { currency: "CHF", owedToYou: "21000", youOwe: "0" },
        { currency: "EUR", owedToYou: "10000", youOwe: "10000" },
      ],
    });

    expect(screen.getByText("CHF 210.00")).toBeVisible();
    expect(screen.queryByText(/€0/)).toBeNull();
    // One currency left standing is not a set to count.
    expect(screen.queryByText("1 currency")).toBeNull();
  });

  /**
   * Owed in one group exactly what is owed in another, in every currency: no
   * rate could change that answer, so it is settled rather than a row of
   * zeroes.
   */
  it("says the word when every currency nets out on its own", () => {
    renderWidget({
      net: null,
      owedToYou: null,
      youOwe: null,
      currencyTotals: [
        { currency: "EUR", owedToYou: "10000", youOwe: "10000" },
      ],
    });

    expect(screen.getByText("Settled up")).toBeVisible();
    expect(screen.queryByText(/0\.00/)).toBeNull();
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
