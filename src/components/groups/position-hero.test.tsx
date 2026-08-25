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
 * revenue plus repayments, and nothing else — so what these tests hold is that
 * claim: each section's subtotal is the pair inside it, the three subtotals
 * reach the final balance, and income is a named section rather than the
 * unexplained remainder it used to arrive as.
 *
 * How those figures are worded — which of them carry a sign, and the sentences
 * under each pair — is held next door, in position-breakdown.test.tsx.
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
  return formatMoney(money(minorUnits, "CHF"), {
    locale: "en",
    display: "code",
    signDisplay: "exceptZero",
  }).replace(/\u00a0/g, " ");
}

/** A row's own total, which carries no sign: it is an amount, not an effect. */
function raw(minorUnits: bigint): string {
  return formatMoney(money(minorUnits, "CHF"), {
    locale: "en",
    display: "code",
  }).replace(/\u00a0/g, " ");
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

/** The card a section header belongs to, which is what holds its rows. */
function sectionFor(name: RegExp): HTMLElement {
  const header = screen.getByRole("button", { name });
  const card = header.closest("section");
  if (!card) throw new Error(`No section card around ${String(name)}`);
  return card;
}

/**
 * Opens a section. The sheet draws all three shut, so the rows inside one are
 * a click away rather than there on arrival.
 */
async function expand(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name }));
  return sectionFor(name);
}

describe("the position sheet's ledger", () => {
  it("subtotals expenses as what the reader paid, less their share", async () => {
    const user = await openSheet();
    const section = await expand(user, /Expenses/);

    expect(within(section).getByText(chf(19180039n))).toBeInTheDocument();
    expect(within(section).getByText(raw(31634847n))).toBeInTheDocument();
    expect(within(section).getByText(raw(12454808n))).toBeInTheDocument();
  });

  /**
   * The bug this redesign exists to fix. Income used to reach the sheet only
   * as "Other adjustments", which in this group is a five-figure number with
   * no name on it.
   */
  it("gives income a section of its own instead of a remainder", async () => {
    const user = await openSheet();
    const section = await expand(user, /Revenue/);

    expect(within(section).getByText("You received")).toBeInTheDocument();
    expect(within(section).getByText(raw(3100000n))).toBeInTheDocument();
    expect(within(section).getByText(raw(390235n))).toBeInTheDocument();
    expect(within(section).getByText(chf(-2709765n))).toBeInTheDocument();
    expect(screen.queryByText("Other adjustments")).not.toBeInTheDocument();
  });

  it("subtotals repayments as what the reader sent, less what they got", async () => {
    const user = await openSheet();
    const section = await expand(user, /Settlements/);

    expect(within(section).getByText(chf(-15159741n))).toBeInTheDocument();
    expect(within(section).getByText(raw(2671n))).toBeInTheDocument();
    expect(within(section).getByText(raw(15162412n))).toBeInTheDocument();
  });

  it("reaches the balance the hero states, from the three subtotals", async () => {
    await openSheet();

    expect(19180039n - 2709765n - 15159741n).toBe(1310533n);
    expect(screen.getByText("Final balance")).toBeInTheDocument();
    expect(screen.getAllByText(chf(1310533n)).length).toBeGreaterThan(0);
  });

  it("shows a remainder the three groups cannot explain", async () => {
    await openSheet([
      {
        ...CHALET,
        minorUnits: "1320533",
        breakdown: { ...CHALET.breakdown, otherAdjustments: "10000" },
      },
    ]);

    expect(screen.getByText("Other adjustments")).toBeInTheDocument();
    expect(screen.getByText(chf(10000n))).toBeInTheDocument();
  });
});

describe("opening a section", () => {
  it("arrives shut, with the subtotal already answering", async () => {
    await openSheet();
    const header = screen.getByRole("button", { name: /Expenses/ });

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("You paid")).not.toBeInTheDocument();
    expect(screen.getByText(chf(19180039n))).toBeInTheDocument();
  });

  it("shows the two rows behind that subtotal, and puts them away again", async () => {
    const user = await openSheet();
    const header = screen.getByRole("button", { name: /Expenses/ });

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("You paid")).toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("You paid")).not.toBeInTheDocument();
  });

  it("leaves the other sections alone", async () => {
    const user = await openSheet();
    await user.click(screen.getByRole("button", { name: /Expenses/ }));

    expect(screen.getByRole("button", { name: /Revenue/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("You received")).not.toBeInTheDocument();
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
   * Two currencies are two ledgers, never one added together — so each keeps
   * its own three sections and its own final balance, under a heading that
   * says which currency the figures below it are in.
   */
  it("heads each ledger with its currency and repeats the sections", async () => {
    await openSheet([CHALET, EUROS]);

    expect(screen.getByRole("heading", { name: "CHF" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "EUR" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Expenses/ })).toHaveLength(2);
    expect(screen.getAllByText("Final balance")).toHaveLength(2);
  });

  it("shows no currency heading when there is only one ledger", async () => {
    await openSheet();

    expect(
      screen.queryByRole("heading", { name: "CHF" }),
    ).not.toBeInTheDocument();
  });
});
