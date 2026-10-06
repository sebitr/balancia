import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { formatMoney, money } from "@/modules/currencies/money";
import { PositionHero, type PositionHeroView } from "./position-hero";

/**
 * The sheet behind "How this is calculated".
 *
 * It makes an arithmetic claim — that the balance in the hero is expenses plus
 * income plus repayments, and nothing else — so what these tests hold is that
 * claim: the sentences it opens on reach the figure the hero states, each
 * section of the figures behind them subtotals the pair inside it, and income
 * is named rather than the unexplained remainder it used to arrive as.
 *
 * How each case is worded — which sentence a ledger calls for, and what is
 * left unsaid when its amount is zero — is held next door, in
 * position-breakdown.test.tsx.
 *
 * Amounts are compared against `formatMoney` rather than against literal
 * strings: the question here is whether the right figure reached the right
 * row, not how Intl writes a Swiss franc this month.
 */

/**
 * The chalet group the design was drawn against: the reader paid most of the
 * bills, took the rental bookings, and has already been repaid nearly all of
 * it. 191,800.39 − 27,097.65 − 151,597.41 = 13,105.33.
 */
const CHALET: PositionHeroView = {
  currency: "CHF",
  minorUnits: "1310533",
  counterparties: [
    { participantId: "p2", name: "Hervé", minorUnits: "1310533" },
  ],
  breakdown: {
    paid: "31634847",
    share: "12454808",
    revenueReceived: "3100000",
    revenueCredited: "390235",
    settlementsPaid: "2671",
    settlementsReceived: "15162412",
    otherAdjustments: "0",
  },
};

/**
 * The same string the component renders, with Intl's non-breaking space
 * relaxed — Testing Library normalizes whitespace on what it finds in the DOM
 * but not on what it is handed to look for.
 */
function chf(minorUnits: bigint): string {
  // The sign is the app's own, not Intl's: a real minus or a plus, a space,
  // then the magnitude, and zero left bare — what `Amount` writes.
  const sign = minorUnits < 0n ? "− " : minorUnits > 0n ? "+ " : "";
  const magnitude = minorUnits < 0n ? -minorUnits : minorUnits;
  return (
    sign +
    formatMoney(money(magnitude, "CHF"), { locale: "en" }).replace(
      /\u00a0/g,
      " ",
    )
  );
}

/** A row's own total, which carries no sign: it is an amount, not an effect. */
function raw(minorUnits: bigint): string {
  return formatMoney(money(minorUnits, "CHF"), { locale: "en" }).replace(
    /\u00a0/g,
    " ",
  );
}

async function openSheet(
  positions: readonly PositionHeroView[] = [CHALET],
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderWithIntl(
    <PositionHero
      positions={positions}
      groupId="g1"
      groupName="Chalet"
      senderName="Seb"
      recipients={[]}
      canArchive={false}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: /How this is calculated/ }),
  );
  return user;
}

const FIGURES = /The figures, line by line/;

/**
 * Opens the figures under the sentences and hands back the panel that holds
 * them. The sheet draws them shut: every amount in them has already been said.
 */
async function openFigures(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  const toggle = screen.getByRole("button", { name: FIGURES });
  await user.click(toggle);
  const panelId = toggle.getAttribute("aria-controls");
  const panel = panelId ? document.getElementById(panelId) : null;
  if (!panel) throw new Error("The figures did not open");
  return panel;
}

describe("the position sheet", () => {
  it("explains the balance in sentences that reach the figure in the hero", async () => {
    await openSheet();

    expect(
      screen.getByText(
        `You paid ${raw(31634847n)}. Your share was ${raw(12454808n)}.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `You received ${raw(3100000n)} of the group's income. Your share of its income was ${raw(390235n)}.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`You have paid back ${raw(2671n)}.`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`You have been paid back ${raw(15162412n)}.`),
    ).toBeInTheDocument();
    expect(31634847n - 12454808n + 390235n - 3100000n + 2671n - 15162412n).toBe(
      1310533n,
    );
    expect(
      screen.getByText(`So you get back ${raw(1310533n)}.`),
    ).toBeInTheDocument();
  });

  it("subtotals expenses as what the reader paid, less their share", async () => {
    const user = await openSheet();
    const panel = await openFigures(user);

    expect(within(panel).getByText(chf(19180039n))).toBeInTheDocument();
    expect(within(panel).getByText(raw(31634847n))).toBeInTheDocument();
    expect(within(panel).getByText(raw(12454808n))).toBeInTheDocument();
  });

  /**
   * The bug an earlier redesign fixed. Income used to reach the sheet only as
   * "Other adjustments", which in this group is a five-figure number with no
   * name on it.
   */
  it("gives income a section of its own instead of a remainder", async () => {
    const user = await openSheet();
    const panel = await openFigures(user);

    expect(within(panel).getByText("Income")).toBeInTheDocument();
    expect(within(panel).getByText("You received")).toBeInTheDocument();
    expect(within(panel).getByText(raw(3100000n))).toBeInTheDocument();
    expect(within(panel).getByText(raw(390235n))).toBeInTheDocument();
    expect(within(panel).getByText(chf(-2709765n))).toBeInTheDocument();
    expect(screen.queryByText(/adjustments/)).not.toBeInTheDocument();
  });

  it("subtotals repayments as what the reader sent, less what they got", async () => {
    const user = await openSheet();
    const panel = await openFigures(user);

    expect(within(panel).getByText(chf(-15159741n))).toBeInTheDocument();
    expect(within(panel).getByText(raw(2671n))).toBeInTheDocument();
    expect(within(panel).getByText(raw(15162412n))).toBeInTheDocument();
  });

  it("shows a remainder the three groups cannot explain", async () => {
    const user = await openSheet([
      {
        ...CHALET,
        minorUnits: "1320533",
        breakdown: { ...CHALET.breakdown, otherAdjustments: "10000" },
      },
    ]);

    expect(
      screen.getByText(
        `Other adjustments raise your balance by ${raw(10000n)}.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`So you get back ${raw(1320533n)}.`),
    ).toBeInTheDocument();

    const panel = await openFigures(user);
    expect(within(panel).getByText("Other adjustments")).toBeInTheDocument();
    expect(within(panel).getByText(chf(10000n))).toBeInTheDocument();
  });
});

describe("opening the figures", () => {
  it("arrives shut, with the sentences already answering", async () => {
    await openSheet();

    expect(screen.getByRole("button", { name: FIGURES })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Expenses")).not.toBeInTheDocument();
    expect(
      screen.getByText(`So you get back ${raw(1310533n)}.`),
    ).toBeInTheDocument();
  });

  it("shows the figures, and puts them away again", async () => {
    const user = await openSheet();
    const toggle = screen.getByRole("button", { name: FIGURES });

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Expenses")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Expenses")).not.toBeInTheDocument();
  });
});

describe("more than one currency", () => {
  const EUROS: PositionHeroView = {
    currency: "EUR",
    minorUnits: "-4500",
    counterparties: [],
    breakdown: {
      paid: "0",
      share: "4500",
      revenueReceived: "0",
      revenueCredited: "0",
      settlementsPaid: "0",
      settlementsReceived: "0",
      otherAdjustments: "0",
    },
  };

  /**
   * Two currencies are two ledgers, never one added together — so each is
   * explained on its own and ends on its own result, under a heading that
   * says which currency the figures below it are in.
   */
  it("heads each explanation with its currency and repeats it", async () => {
    await openSheet([CHALET, EUROS]);

    expect(screen.getByRole("heading", { name: "CHF" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "EUR" })).toBeInTheDocument();
    expect(
      screen.getByText(`So you get back ${raw(1310533n)}.`),
    ).toBeInTheDocument();
    expect(screen.getByText("So you owe €45.00.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: FIGURES })).toHaveLength(2);
  });

  it("shows no currency heading when there is only one ledger", async () => {
    await openSheet();

    expect(
      screen.queryByRole("heading", { name: "CHF" }),
    ).not.toBeInTheDocument();
  });
});
