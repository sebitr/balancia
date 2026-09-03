import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { AppLocale } from "@/i18n/locales";
import { formatMoney, money } from "@/modules/currencies/money";
import {
  compareToShare,
  PositionBreakdown,
  type PositionView,
} from "./position-breakdown";

/**
 * What the ledger says, as opposed to what it adds up to.
 *
 * The arithmetic is held by the two sheet tests beside this one. What is held
 * here is the reading: that a signed figure appears only where a sign means
 * "this is what the group did to your balance", that the six totals behind
 * those figures are stated plainly, and that every difference the reader would
 * otherwise have to work out from two numbers and a minus sign is written out
 * in a sentence instead.
 *
 * Amounts are compared against `formatMoney` rather than against literal
 * strings: the question is whether the right figure reached the right row, not
 * how Intl writes a Swiss franc this month.
 */

/** The chalet group from the design: paid less than their share, collected
 *  rent that was mostly not theirs, and has repaid nearly all of it. */
const CHALET: PositionView = {
  currency: "CHF",
  minorUnits: "-115000",
  counterparties: [{ participantId: "p2", name: "Hervé", minorUnits: "0" }],
  breakdown: {
    paid: "29000",
    share: "43667",
    revenueReceived: "300000",
    revenueCredited: "100000",
    settlementsPaid: "99667",
    settlementsReceived: "0",
    otherAdjustments: "0",
  },
};

function view(
  breakdown: Partial<PositionView["breakdown"]>,
  minorUnits = "0",
  currency = "CHF",
): PositionView {
  return {
    currency,
    minorUnits,
    counterparties: [],
    breakdown: { ...CHALET.breakdown, ...breakdown },
  };
}

/**
 * The same string the component renders, with Intl's non-breaking space
 * relaxed — Testing Library normalizes whitespace on what it finds in the DOM
 * but not on what it is handed to look for.
 */
function amount(
  minorUnits: bigint,
  currency = "CHF",
  signDisplay?: "exceptZero",
): string {
  // The sign is the app's own, not Intl's: `Amount` writes a real minus for
  // any loss, a plus for a gain only when asked, then a space, then the
  // magnitude, and leaves zero bare.
  const sign =
    minorUnits < 0n ? "− " : minorUnits > 0n && signDisplay ? "+ " : "";
  const magnitude = minorUnits < 0n ? -minorUnits : minorUnits;
  return (
    sign +
    formatMoney(money(magnitude, currency), {
      locale: "en",
      display: "code",
    }).replace(/\u00a0/g, " ")
  );
}

/** The signed figure a section header states: its effect on the balance. */
function impact(minorUnits: bigint, currency = "CHF"): string {
  return amount(minorUnits, currency, "exceptZero");
}

async function show(
  position: PositionView = CHALET,
  locale: AppLocale = "en",
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderWithIntl(
    <PositionBreakdown position={position} showCurrency={false} />,
    {
      locale,
    },
  );
  return user;
}

/** Opens a section and hands back the card that holds its rows. */
async function expand(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
): Promise<HTMLElement> {
  const header = screen.getByRole("button", { name });
  await user.click(header);
  const card = header.closest("section");
  if (!card) throw new Error(`No section card around ${String(name)}`);
  return card;
}

describe("comparing a total against a share", () => {
  it("names the gap and which way it ran", () => {
    expect(compareToShare(29000n, 43667n)).toEqual({
      side: "less",
      gap: 14667n,
    });
    expect(compareToShare(300000n, 100000n)).toEqual({
      side: "more",
      gap: 200000n,
    });
  });

  /**
   * The sentence "you paid 0.00 less than your share" is the reason this
   * returns three answers rather than a signed difference.
   */
  it("calls a match level rather than a gap of nothing", () => {
    expect(compareToShare(43667n, 43667n)).toEqual({ side: "equal", gap: 0n });
    expect(compareToShare(0n, 0n)).toEqual({ side: "equal", gap: 0n });
  });

  it("keeps the gap unsigned whichever total is larger", () => {
    expect(compareToShare(0n, 999999999999n).gap).toBe(999999999999n);
    expect(compareToShare(999999999999n, 0n).gap).toBe(999999999999n);
  });
});

describe("a section header", () => {
  it("signs its subtotal, so the sign reads as the effect on the balance", async () => {
    await show();

    expect(screen.getByText(impact(-14667n))).toBeInTheDocument();
    expect(screen.getByText(impact(-200000n))).toBeInTheDocument();
    expect(screen.getByText(impact(99667n))).toBeInTheDocument();
  });
});

describe("the rows behind a subtotal", () => {
  it("states the two expense totals plainly, with no sign on either", async () => {
    const user = await show();
    const section = await expand(user, /Expenses/);

    expect(within(section).getByText("You paid")).toBeInTheDocument();
    expect(within(section).getByText("Your share")).toBeInTheDocument();
    expect(within(section).getByText(amount(29000n))).toBeInTheDocument();
    expect(within(section).getByText(amount(43667n))).toBeInTheDocument();
    expect(
      within(section).queryByText(impact(-43667n)),
    ).not.toBeInTheDocument();
  });

  it("states the two revenue totals the same way", async () => {
    const user = await show();
    const section = await expand(user, /Revenue/);

    expect(within(section).getByText("You received")).toBeInTheDocument();
    expect(within(section).getByText("Your share")).toBeInTheDocument();
    expect(within(section).getByText(amount(300000n))).toBeInTheDocument();
    expect(within(section).getByText(amount(100000n))).toBeInTheDocument();
  });

  it("states repayments in both directions, zero included", async () => {
    const user = await show();
    const section = await expand(user, /Settlements/);

    expect(within(section).getByText("You paid back")).toBeInTheDocument();
    expect(within(section).getByText("You were paid back")).toBeInTheDocument();
    expect(within(section).getByText(amount(99667n))).toBeInTheDocument();
    expect(within(section).getByText(amount(0n))).toBeInTheDocument();
    expect(
      within(section).getByText("Repayments already made."),
    ).toBeInTheDocument();
  });
});

describe("the sentence under a pair of expense totals", () => {
  it("says how far under their share the reader paid", async () => {
    const user = await show();
    const section = await expand(user, /Expenses/);

    expect(
      within(section).getByText(
        `You paid ${amount(14667n)} less than your share.`,
      ),
    ).toBeInTheDocument();
  });

  it("says how far over it, when they carried the group", async () => {
    const user = await show(view({ paid: "43667", share: "29000" }));
    const section = await expand(user, /Expenses/);

    expect(
      within(section).getByText(
        `You paid ${amount(14667n)} more than your share.`,
      ),
    ).toBeInTheDocument();
  });

  /** The absurd sentence this replaces: "you paid 0.00 less than your share". */
  it("names no figure at all when the two match", async () => {
    const user = await show(view({ paid: "43667", share: "43667" }));
    const section = await expand(user, /Expenses/);

    expect(
      within(section).getByText("You paid exactly your share."),
    ).toBeInTheDocument();
    expect(within(section).queryByText(/0\.00 less/)).not.toBeInTheDocument();
  });

  /** A group with no expenses at all lands on the same sentence. */
  it("treats an empty ledger as a match rather than a gap", async () => {
    const user = await show(view({ paid: "0", share: "0" }));
    const section = await expand(user, /Expenses/);

    expect(
      within(section).getByText("You paid exactly your share."),
    ).toBeInTheDocument();
  });
});

describe("the sentence under a pair of revenue totals", () => {
  it("says how much of what came in was not the reader's", async () => {
    const user = await show();
    const section = await expand(user, /Revenue/);

    expect(
      within(section).getByText(
        `You received ${amount(200000n)} more than your share.`,
      ),
    ).toBeInTheDocument();
  });

  it("says the other direction when the group collected for them", async () => {
    const user = await show(
      view({ revenueReceived: "100000", revenueCredited: "300000" }),
    );
    const section = await expand(user, /Revenue/);

    expect(
      within(section).getByText(
        `You received ${amount(200000n)} less than your share.`,
      ),
    ).toBeInTheDocument();
  });

  /** A group that never took a franc in: the commonest case of all. */
  it("says nothing about a figure in a group with no revenue", async () => {
    const user = await show(
      view({ revenueReceived: "0", revenueCredited: "0" }),
    );
    const section = await expand(user, /Revenue/);

    expect(
      within(section).getByText("You received exactly your share."),
    ).toBeInTheDocument();
  });
});

describe("the final balance", () => {
  it("signs the figure negative when the reader is behind", async () => {
    await show(view({}, "-115000"));

    expect(screen.getByText("Final balance")).toBeInTheDocument();
    expect(screen.getByText(impact(-115000n))).toBeInTheDocument();
  });

  it("signs it the other way round when the group is behind", async () => {
    await show(view({}, "115000"));

    expect(screen.getByText(impact(115000n))).toBeInTheDocument();
  });

  /** Zero is the one balance `signDisplay: "exceptZero"` leaves bare. */
  it("carries no sign when there is nothing outstanding", async () => {
    await show(view({}, "0"));

    expect(screen.getByText(amount(0n))).toBeInTheDocument();
  });

  it("survives a balance far larger than the design was drawn against", async () => {
    await show(view({}, "-9876543210"));

    expect(screen.getByText(impact(-9876543210n))).toBeInTheDocument();
  });
});

describe("currencies other than the one it was drawn in", () => {
  it("writes euros the way the reader's notation does", async () => {
    const user = await show(view({}, "-4500", "EUR"));
    const section = await expand(user, /Expenses/);

    expect(
      within(section).getByText(
        `You paid ${amount(14667n, "EUR")} less than your share.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(impact(-4500n, "EUR"))).toBeInTheDocument();
  });

  /** Yen has no minor unit, so nothing in the sentence may invent one. */
  it("keeps a currency without decimals free of them", async () => {
    const user = await show(
      view({ paid: "29000", share: "43667" }, "-14667", "JPY"),
    );
    const section = await expand(user, /Expenses/);

    expect(
      within(section).getByText(
        `You paid ${amount(14667n, "JPY")} less than your share.`,
      ),
    ).toBeInTheDocument();
    expect(amount(14667n, "JPY")).not.toMatch(/[.,]\d\d$/);
  });
});

describe("in French", () => {
  it("puts the sheet in the reader's own language", async () => {
    const user = await show(CHALET, "fr");

    expect(screen.getByText("Solde final")).toBeInTheDocument();

    const section = await expand(user, /Dépenses/);
    expect(within(section).getByText("Tu as payé")).toBeInTheDocument();
    expect(within(section).getByText("Ta part")).toBeInTheDocument();
    expect(
      within(section).getByText(
        `Tu as payé ${amount(14667n)} de moins que ta part.`,
      ),
    ).toBeInTheDocument();
  });
});
