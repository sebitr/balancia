import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import {
  CurrencyBalances,
  type CurrencyBalanceView,
} from "./currency-balances";

/**
 * The collapsible currency list.
 *
 * What these hold is the part of the design that is design-system law rather
 * than preference: one row open at a time, a settled balance phrased instead
 * of printed as `0.00`, a currency everyone is square in drawn as a line with
 * nothing to open, and a direction word attached to every amount even where
 * the layout hides it — the section heading names no side, so an amount with
 * only an arrow and a colour to explain it says nothing to a screen reader.
 *
 * The rows are `<button>`s with `aria-expanded` and `aria-controls`, so the
 * queries here go through the accessibility tree on purpose: a test that found
 * these rows by class would keep passing after the markup stopped being a
 * disclosure at all.
 */

const CHF: CurrencyBalanceView = {
  currency: "CHF",
  totalSpent: "35000",
  position: "11666",
  members: [
    { participantId: "p2", name: "Hervé", minorUnits: "-11666", isSelf: false },
    { participantId: "p3", name: "Vera", minorUnits: "0", isSelf: false },
    { participantId: "p1", name: "Seb", minorUnits: "11666", isSelf: true },
  ],
  transfers: [
    {
      fromParticipantId: "p2",
      fromName: "Hervé",
      toParticipantId: "p1",
      toName: "Seb",
      minorUnits: "11666",
      fromIsSelf: false,
      toIsSelf: true,
    },
  ],
};

const USD: CurrencyBalanceView = {
  currency: "USD",
  totalSpent: "12630",
  position: "-4210",
  members: [
    { participantId: "p1", name: "Seb", minorUnits: "-4210", isSelf: true },
    { participantId: "p2", name: "Hervé", minorUnits: "4210", isSelf: false },
  ],
  transfers: [
    {
      fromParticipantId: "p1",
      fromName: "Seb",
      toParticipantId: "p2",
      toName: "Hervé",
      minorUnits: "4210",
      fromIsSelf: true,
      toIsSelf: false,
    },
  ],
};

/** Spent in, square in: the state that must never render as an amount. */
const GBP: CurrencyBalanceView = {
  currency: "GBP",
  totalSpent: "4800",
  position: "0",
  members: [
    { participantId: "p1", name: "Seb", minorUnits: "0", isSelf: true },
    { participantId: "p2", name: "Hervé", minorUnits: "0", isSelf: false },
  ],
  transfers: [],
};

/** A debt the reader is not part of, in a currency they are square in. */
const EUR: CurrencyBalanceView = {
  currency: "EUR",
  totalSpent: "2600",
  position: "0",
  members: [
    { participantId: "p1", name: "Seb", minorUnits: "0", isSelf: true },
    { participantId: "p2", name: "Hervé", minorUnits: "-1734", isSelf: false },
    { participantId: "p3", name: "Vera", minorUnits: "1734", isSelf: false },
  ],
  transfers: [
    {
      fromParticipantId: "p2",
      fromName: "Hervé",
      toParticipantId: "p3",
      toName: "Vera",
      minorUnits: "1734",
      fromIsSelf: false,
      toIsSelf: false,
    },
  ],
};

function renderList(
  currencies: readonly CurrencyBalanceView[] = [CHF, USD, GBP],
  defaultOpen: string | null = "CHF",
) {
  return renderWithIntl(
    <CurrencyBalances
      currencies={currencies}
      groupId="g1"
      groupName="Chalet"
      senderName="Seb"
      recipients={[
        {
          participantId: "p2",
          name: "Hervé",
          debts: [{ amount: "11666", currency: "CHF" }],
          channel: "share",
          lastRemindedAt: null,
          locked: false,
          muted: false,
        },
      ]}
      participantCount={3}
      defaultOpen={defaultOpen}
    />,
  );
}

/** The disclosure button for one currency, found the way a reader reaches it. */
function row(code: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${code}`) });
}

/** One currency's line, whether or not it is a disclosure. */
function heading(code: string): HTMLElement {
  return screen.getByRole("heading", { name: new RegExp(`^${code}`) });
}

/** What that row opens, resolved through `aria-controls` rather than by class. */
function body(code: string): HTMLElement {
  const id = row(code).getAttribute("aria-controls");
  expect(id).toBeTruthy();
  const element = document.getElementById(id!);
  expect(element).toBeTruthy();
  return element!;
}

describe("CurrencyBalances", () => {
  it("opens the currency it was given and no other", () => {
    renderList();

    expect(row("CHF")).toHaveAttribute("aria-expanded", "true");
    expect(row("USD")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^GBP/ })).toBeNull();
  });

  it("closes the open row when another is opened", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(row("USD"));

    expect(row("USD")).toHaveAttribute("aria-expanded", "true");
    expect(row("CHF")).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the open row when its own header is tapped, leaving none open", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(row("CHF"));

    for (const code of ["CHF", "USD"]) {
      expect(row(code)).toHaveAttribute("aria-expanded", "false");
    }
  });

  /**
   * A closed body stays mounted so `aria-controls` has a target, which is
   * exactly how a disclosure leaks its contents to a screen reader. `inert` is
   * what stops it.
   */
  it("keeps a closed body out of the reading order", async () => {
    const user = userEvent.setup();
    renderList();

    expect(body("CHF")).not.toHaveAttribute("inert");
    expect(body("USD")).toHaveAttribute("inert");

    await user.click(row("USD"));

    expect(body("USD")).not.toHaveAttribute("inert");
    expect(body("CHF")).toHaveAttribute("inert");
  });

  it("states the side in words on a row amount, where the heading does not", () => {
    renderList();

    // The arrow and the colour carry it on screen; the word carries it to
    // everyone else. Both rows have one, and they differ.
    expect(within(row("CHF")).getByText("get back")).toBeInTheDocument();
    expect(within(row("USD")).getByText("owe")).toBeInTheDocument();
  });

  it("phrases a settled currency instead of printing a zero", () => {
    renderList();

    const settled = heading("GBP");
    expect(within(settled).getByText("Settled up")).toBeInTheDocument();
    expect(settled).not.toHaveTextContent("0.00");
    // A currency with nothing to clear counts no payments.
    expect(settled).not.toHaveTextContent(/payment/);
    expect(settled).toHaveTextContent(/48\.00 spent/);
  });

  it("names the spend and the payments that would clear a currency", () => {
    renderList();

    expect(row("CHF")).toHaveTextContent(/350\.00 spent · 1 payment/);
  });

  /**
   * A currency everyone is square in has nothing to list, so it is a line
   * rather than a disclosure: no chevron, no body, and no tap that answers
   * with one sentence the header had already said.
   */
  it("folds a currency everyone is square in into a line that opens nothing", () => {
    renderList();

    expect(screen.queryByRole("button", { name: /^GBP/ })).toBeNull();
    expect(heading("GBP")).toHaveTextContent(/48\.00 spent/);
    expect(heading("GBP")).toHaveTextContent("Settled up");
    expect(screen.queryByText(/Everyone is square/)).not.toBeInTheDocument();
  });

  it("offers Pay on the reader's own debt and Remind on one owed to them", async () => {
    const user = userEvent.setup();
    renderList();

    expect(
      within(body("CHF")).getByRole("button", { name: "Remind" }),
    ).toBeInTheDocument();

    await user.click(row("USD"));

    expect(
      within(body("USD")).getByRole("link", { name: "Pay" }),
    ).toBeInTheDocument();
  });

  /**
   * Reminding on someone else's behalf is deliberately absent from this app,
   * and paying their debt is not the reader's to do — so a transfer between
   * two other people carries no action at all.
   */
  it("attaches no action to a debt between two other people", () => {
    renderList([EUR], "EUR");

    // Named twice: once as a balance, once as the payer of the transfer.
    const opened = body("EUR");
    expect(within(opened).getAllByText("Hervé")).toHaveLength(2);
    expect(within(opened).queryByRole("button", { name: "Remind" })).toBeNull();
    expect(within(opened).queryByRole("link", { name: "Pay" })).toBeNull();

    // The reader is square here even though the currency is not, so the row
    // shows their position as settled, stays a disclosure, and the body still
    // lists the debt.
    expect(within(row("EUR")).getByText("Settled up")).toBeInTheDocument();
    expect(row("EUR")).toHaveAttribute("aria-expanded", "true");
  });

  it("holds its shape at one currency and at six", () => {
    const { unmount } = renderList([CHF], "CHF");
    expect(row("CHF")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("1 currency · 3 people")).toBeInTheDocument();
    unmount();

    const many = ["CHF", "USD", "GBP", "EUR", "JPY", "SEK"].map((code) => ({
      ...GBP,
      currency: code,
    }));
    renderList(many, "CHF");
    expect(screen.getAllByRole("heading", { name: /spent/ })).toHaveLength(6);
    expect(screen.getByText("6 currencies · 3 people")).toBeInTheDocument();
  });

  it("drops the settlement footer when nothing is outstanding", () => {
    renderList([GBP], "GBP");

    expect(
      screen.queryByRole("link", { name: "View suggested settlement" }),
    ).toBeNull();
  });

  it("counts the payments the settlement plan would make", () => {
    renderList();

    expect(
      screen.getByRole("link", { name: "View suggested settlement" }),
    ).toHaveTextContent("2 payments clear all 3 currencies");
  });
});
