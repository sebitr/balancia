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
   * A group made a minute ago has no balance, which used to read as "Settled
   * up · Nothing outstanding in 1 group" — the words for everybody having paid
   * everybody back, about a trip that had not started.
   */
  it("says nothing has been recorded when no group has started", () => {
    renderWidget({
      net: null,
      owedToYou: null,
      youOwe: null,
      displayCurrency: null,
      converted: false,
      unstarted: { count: 1 },
    });

    expect(screen.getByText("No expenses yet")).toBeVisible();
    expect(screen.getByText("Nothing recorded in 1 group yet")).toBeVisible();
    expect(screen.queryByText("Settled up")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing outstanding/)).not.toBeInTheDocument();
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

/*
 * The card from `lg`, as the desktop board "01 · Home" draws it. jsdom runs no
 * media queries, so what is held is what each width is given, by the classes
 * that give it.
 */
describe("PositionWidget from lg", () => {
  /** The board's own account: CHF 103.50 owing, €223.70 owed, no rate. */
  const PAIR = {
    net: null,
    owedToYou: null,
    youOwe: null,
    currencyTotals: [
      { currency: "CHF", owedToYou: "0", youOwe: "10350" },
      { currency: "EUR", owedToYou: "22370", youOwe: "0" },
    ],
  } satisfies Partial<PositionWidgetProps>;

  it("stands two currencies side by side, the debt first, at one size", () => {
    renderWidget(PAIR);

    const region = screen.getByRole("region", { name: "Total balance" });
    expect(region.firstElementChild).toHaveClass("lg:flex-row", "lg:flex-wrap");

    // The debt still leads, and still opens the reason there are two.
    const lead = screen.getByRole("button", { name: /CHF\s*103\.50/ });
    expect(lead).toBeVisible();
    // The credit beside it takes the lead's size from `lg`.
    expect(screen.getByText("€223.70")).toHaveClass(
      "text-base",
      "lg:text-[2.125rem]",
    );
  });

  /**
   * Half the card each, but never less than the figure: two five-figure
   * amounts in the 1280px column wrap one under the other rather than run
   * into each other.
   */
  it("gives each of the pair half the card, and lets them wrap", () => {
    renderWidget(PAIR);

    const half = "lg:basis-[calc(50%_-_0.75rem)]";
    expect(screen.getByRole("button", { name: /CHF\s*103\.50/ })).toHaveClass(
      half,
    );
    expect(screen.getByRole("list")).toHaveClass(half);
    expect(screen.getByRole("listitem")).toHaveClass(
      "lg:grid-cols-[26px_auto]",
    );
  });

  it("puts each word under its figure in the tone's ink", () => {
    renderWidget(PAIR);

    const [row] = screen.getAllByRole("listitem");
    expect(row).toHaveClass("lg:grid", "text-positive-ink");
    expect(screen.getByText("you are owed")).toHaveClass(
      "lg:row-start-2",
      "lg:text-inherit",
    );
    expect(screen.getByText("you owe")).toHaveClass("lg:text-inherit");
    expect(screen.getByText("you owe").parentElement).toHaveClass(
      "text-negative-ink",
    );
  });

  /** Four answer-sized figures in a row is the stack #323 took away. */
  it("keeps the lead and the rows for three currencies or more", () => {
    renderWidget({
      net: null,
      owedToYou: null,
      youOwe: null,
      currencyTotals: [
        { currency: "CHF", owedToYou: "0", youOwe: "216100" },
        { currency: "EUR", owedToYou: "63200", youOwe: "0" },
        { currency: "USD", owedToYou: "0", youOwe: "18000" },
      ],
    });

    const region = screen.getByRole("region", { name: "Total balance" });
    expect(region.firstElementChild).not.toHaveClass("lg:flex-row");
    expect(screen.getByText("€632.00")).not.toHaveClass("lg:text-[2.125rem]");
  });

  it("keeps the reason behind the figure rather than as a standing line", () => {
    renderWidget(PAIR);

    expect(
      screen.queryByText(
        "Shown per currency. There is no exchange rate to combine them into one total.",
      ),
    ).not.toBeInTheDocument();
  });

  /** The sidebar holds Add expense, and the title row New group. */
  it("lets its two actions step aside", () => {
    renderWidget(PAIR);

    const strip = screen.getByRole("button", {
      name: /Add expense/,
    }).parentElement;
    expect(strip).toHaveClass("lg:hidden");
    expect(strip).toContainElement(
      screen.getByRole("link", { name: /New group/ }),
    );
  });
});
