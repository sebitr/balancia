import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { AppLocale } from "@/i18n/locales";
import { TONE } from "@/components/money/balance-tone";
import { formatMoney, money } from "@/modules/currencies/money";
import { PositionBreakdown, type PositionView } from "./position-breakdown";

/**
 * What the sheet behind "How this is calculated" says.
 *
 * Somebody opens it because the figure in the hero made no sense to them, so
 * what is held here is the reading: that it opens on sentences rather than on
 * ledger accounts, that the sentences add up to the figure, that it ends on
 * the result with its word and in its tone, and that nothing whose amount is
 * zero is said at all. The figures themselves are still there, one tap away,
 * for whoever wants the arithmetic.
 *
 * Every position below is built by `view`, which works its balance out from
 * its ledger — so a sentence that did not add up to the result would show up
 * as a test asserting the wrong result.
 *
 * Amounts are compared against `formatMoney` rather than against literal
 * strings: the question is whether the right figure reached the right
 * sentence, not how Intl writes a Swiss franc this month.
 */

const NOTHING: PositionView["breakdown"] = {
  paid: "0",
  share: "0",
  revenueReceived: "0",
  revenueCredited: "0",
  settlementsPaid: "0",
  settlementsReceived: "0",
  otherAdjustments: "0",
};

/** A position whose balance is exactly what its ledger adds up to. */
function view(
  ledger: Partial<PositionView["breakdown"]>,
  currency = "EUR",
): PositionView {
  const breakdown = { ...NOTHING, ...ledger };
  const n = (key: keyof PositionView["breakdown"]) => BigInt(breakdown[key]);
  const balance =
    n("paid") -
    n("share") +
    n("revenueCredited") -
    n("revenueReceived") +
    n("settlementsPaid") -
    n("settlementsReceived") +
    n("otherAdjustments");
  return {
    currency,
    minorUnits: balance.toString(),
    counterparties: [],
    breakdown,
  };
}

/**
 * The same string the component renders, with Intl's non-breaking space
 * relaxed — Testing Library normalizes whitespace on what it finds in the DOM
 * but not on what it is handed to look for.
 */
function figure(
  minorUnits: bigint,
  currency = "EUR",
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
    }).replace(/ /g, " ")
  );
}

function show(
  position: PositionView,
  options: { locale?: AppLocale; showCurrency?: boolean } = {},
): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  renderWithIntl(
    <PositionBreakdown
      position={position}
      showCurrency={options.showCurrency ?? false}
    />,
    { locale: options.locale ?? "en" },
  );
  return user;
}

/** Every sentence the sheet says, in the order it says them. */
function sentences(): string[] {
  return screen
    .getAllByRole("paragraph")
    .map((paragraph) => paragraph.textContent?.replace(/\s+/g, " ") ?? "");
}

const FIGURES = /The figures, line by line/;

/** Opens the figures and hands back the panel that holds them. */
async function openFigures(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp = FIGURES,
): Promise<HTMLElement> {
  const toggle = screen.getByRole("button", { name });
  await user.click(toggle);
  const panelId = toggle.getAttribute("aria-controls");
  const panel = panelId ? document.getElementById(panelId) : null;
  if (!panel) throw new Error("The figures did not open");
  return panel;
}

describe("the opening sentence, about expenses", () => {
  it("states what the reader paid and their share, then that they get the difference back", () => {
    show(view({ paid: "9000", share: "3000" }));

    expect(sentences()).toEqual([
      `You paid ${figure(9000n)}. Your share was ${figure(3000n)}.`,
      `So you get back ${figure(6000n)}.`,
    ]);
  });

  it("says the same the other way round when they paid less than their share", () => {
    show(view({ paid: "1000", share: "4000" }));

    expect(sentences()).toEqual([
      `You paid ${figure(1000n)}. Your share was ${figure(4000n)}.`,
      `So you owe ${figure(3000n)}.`,
    ]);
  });

  it("calls a match exactly their share, and names no gap", () => {
    show(view({ paid: "3000", share: "3000" }));

    expect(sentences()).toEqual([
      `You paid ${figure(3000n)}, exactly your share.`,
      "So you are settled up.",
    ]);
    expect(screen.queryByText(/€0\.00/)).not.toBeInTheDocument();
  });

  /** "You paid €0.00" is a figure the reader has to parse to read nothing. */
  it("says the reader paid nothing rather than naming a zero", () => {
    show(view({ share: "4000" }));

    expect(sentences()).toEqual([
      `You paid nothing. Your share was ${figure(4000n)}.`,
      `So you owe ${figure(4000n)}.`,
    ]);
  });

  it("says when everything the reader paid was for the others", () => {
    show(view({ paid: "5000" }));

    expect(sentences()).toEqual([
      `You paid ${figure(5000n)}, all of it for the others.`,
      `So you get back ${figure(5000n)}.`,
    ]);
  });

  it("says so when nothing has been recorded for the reader yet", () => {
    show(view({}));

    expect(sentences()).toEqual([
      "You are not part of any expense yet.",
      "So you are settled up.",
    ]);
  });
});

describe("income", () => {
  it("says what the reader received and what their share of it was", () => {
    show(
      view({
        paid: "9000",
        share: "3000",
        revenueReceived: "2000",
        revenueCredited: "1000",
      }),
    );

    expect(sentences()).toEqual([
      `You paid ${figure(9000n)}. Your share was ${figure(3000n)}.`,
      `You received ${figure(2000n)} of the group's income. Your share of its income was ${figure(1000n)}.`,
      `So you get back ${figure(5000n)}.`,
    ]);
  });

  it("says when none of what they received was theirs", () => {
    show(view({ paid: "9000", share: "3000", revenueReceived: "2000" }));

    expect(
      screen.getByText(
        `You received ${figure(2000n)} of the group's income, all of it for the others.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`So you get back ${figure(4000n)}.`),
    ).toBeInTheDocument();
  });

  it("says when the others received it and the reader had a share", () => {
    show(view({ paid: "9000", share: "3000", revenueCredited: "1000" }));

    expect(
      screen.getByText(
        `Others received the group's income. Your share of it was ${figure(1000n)}.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`So you get back ${figure(7000n)}.`),
    ).toBeInTheDocument();
  });

  /** A group that never took a cent in: the commonest case of all. */
  it("is not mentioned in a group that has none", () => {
    show(view({ paid: "9000", share: "3000" }));

    expect(screen.queryByText(/income/)).not.toBeInTheDocument();
  });
});

describe("repayments", () => {
  it("says what the reader has paid back", () => {
    show(view({ paid: "1000", share: "4000", settlementsPaid: "2000" }));

    expect(sentences()).toEqual([
      `You paid ${figure(1000n)}. Your share was ${figure(4000n)}.`,
      `You have paid back ${figure(2000n)}.`,
      `So you owe ${figure(1000n)}.`,
    ]);
  });

  it("says what the reader has been paid back", () => {
    show(view({ paid: "9000", share: "3000", settlementsReceived: "6000" }));

    expect(sentences()).toEqual([
      `You paid ${figure(9000n)}. Your share was ${figure(3000n)}.`,
      `You have been paid back ${figure(6000n)}.`,
      "So you are settled up.",
    ]);
  });

  it("says both when money went both ways", () => {
    show(
      view({
        paid: "9000",
        share: "3000",
        settlementsPaid: "500",
        settlementsReceived: "2500",
      }),
    );

    expect(
      screen.getByText(`You have paid back ${figure(500n)}.`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`You have been paid back ${figure(2500n)}.`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`So you get back ${figure(4000n)}.`),
    ).toBeInTheDocument();
  });

  it("are not mentioned when there have been none", () => {
    show(view({ paid: "9000", share: "3000" }));

    expect(screen.queryByText(/paid back/)).not.toBeInTheDocument();
  });
});

describe("a remainder the three cannot explain", () => {
  it("is said in words, whichever way it runs", () => {
    const { unmount } = renderWithIntl(
      <PositionBreakdown
        position={view({
          paid: "9000",
          share: "3000",
          otherAdjustments: "500",
        })}
        showCurrency={false}
      />,
    );
    expect(
      screen.getByText(
        `Other adjustments raise your balance by ${figure(500n)}.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`So you get back ${figure(6500n)}.`),
    ).toBeInTheDocument();
    unmount();

    show(view({ paid: "9000", share: "3000", otherAdjustments: "-500" }));
    expect(
      screen.getByText(
        `Other adjustments lower your balance by ${figure(500n)}.`,
      ),
    ).toBeInTheDocument();
  });

  it("is not mentioned when there is none, which is always today", () => {
    show(view({ paid: "9000", share: "3000" }));

    expect(screen.queryByText(/adjustments/)).not.toBeInTheDocument();
  });
});

describe("the result", () => {
  it("is in the tone of the side it names", () => {
    const { unmount } = renderWithIntl(
      <PositionBreakdown
        position={view({ paid: "9000", share: "3000" })}
        showCurrency={false}
      />,
    );
    expect(screen.getByText(`So you get back ${figure(6000n)}.`)).toHaveClass(
      TONE.positive.ink,
    );
    unmount();

    const second = renderWithIntl(
      <PositionBreakdown
        position={view({ paid: "1000", share: "4000" })}
        showCurrency={false}
      />,
    );
    expect(screen.getByText(`So you owe ${figure(3000n)}.`)).toHaveClass(
      TONE.negative.ink,
    );
    second.unmount();

    show(view({ paid: "3000", share: "3000" }));
    expect(screen.getByText("So you are settled up.")).toHaveClass(
      TONE.neutral.ink,
    );
  });

  /** The thing the sheet used to lead with, and what nobody could read. */
  it("never states a bare signed figure until the figures are asked for", () => {
    show(
      view({
        paid: "9000",
        share: "3000",
        revenueReceived: "2000",
        revenueCredited: "1000",
        settlementsReceived: "1500",
      }),
    );

    expect(screen.queryByText(/[+−]\s*€/)).not.toBeInTheDocument();
    expect(screen.queryByText("Expenses")).not.toBeInTheDocument();
  });

  it("survives a balance far larger than the design was drawn against", () => {
    show(view({ share: "9876543210" }));

    expect(
      screen.getByText(`So you owe ${figure(9876543210n)}.`),
    ).toBeInTheDocument();
  });
});

describe("the figures", () => {
  const LEDGER = view({
    paid: "9000",
    share: "3000",
    revenueReceived: "2000",
    revenueCredited: "1000",
    settlementsReceived: "1500",
  });

  it("arrive shut, under a result that has already been said", () => {
    show(LEDGER);

    expect(screen.getByRole("button", { name: FIGURES })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("You were paid back")).not.toBeInTheDocument();
    expect(
      screen.getByText(`So you get back ${figure(3500n)}.`),
    ).toBeInTheDocument();
  });

  it("open on each section's effect, signed, over the totals behind it, unsigned", async () => {
    const user = show(LEDGER);
    const panel = await openFigures(user);

    expect(screen.getByRole("button", { name: FIGURES })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(panel).getByText("Expenses")).toBeInTheDocument();
    expect(
      within(panel).getByText(figure(6000n, "EUR", "exceptZero")),
    ).toBeInTheDocument();
    expect(within(panel).getByText("You paid")).toBeInTheDocument();
    expect(within(panel).getByText(figure(9000n))).toBeInTheDocument();
    expect(within(panel).getAllByText("Your share")).toHaveLength(2);
    expect(within(panel).getByText(figure(3000n))).toBeInTheDocument();

    expect(within(panel).getByText("Income")).toBeInTheDocument();
    expect(within(panel).getByText(figure(-1000n))).toBeInTheDocument();
    expect(within(panel).getByText("You received")).toBeInTheDocument();
    expect(within(panel).getByText(figure(2000n))).toBeInTheDocument();

    expect(within(panel).getByText("Repayments")).toBeInTheDocument();
    expect(within(panel).getByText(figure(-1500n))).toBeInTheDocument();
    expect(within(panel).getByText("You were paid back")).toBeInTheDocument();
  });

  it("call income Income, as the form that records it does", async () => {
    const user = show(LEDGER);
    const panel = await openFigures(user);

    expect(within(panel).queryByText(/Revenue/)).not.toBeInTheDocument();
  });

  it("leave out every row whose amount is zero, and a section left empty", async () => {
    const user = show(view({ share: "4000", settlementsPaid: "1000" }));
    const panel = await openFigures(user);

    // Expenses: a share, and nothing paid.
    expect(within(panel).getByText("Your share")).toBeInTheDocument();
    expect(within(panel).queryByText("You paid")).not.toBeInTheDocument();
    // Repayments: one way only.
    expect(within(panel).getByText("You paid back")).toBeInTheDocument();
    expect(
      within(panel).queryByText("You were paid back"),
    ).not.toBeInTheDocument();
    // Income: none at all, so no section.
    expect(within(panel).queryByText("Income")).not.toBeInTheDocument();
    expect(within(panel).queryByText("You received")).not.toBeInTheDocument();
    expect(within(panel).queryByText(/€0\.00/)).not.toBeInTheDocument();
  });

  it("list a remainder on a line of its own", async () => {
    const user = show(
      view({ paid: "9000", share: "3000", otherAdjustments: "500" }),
    );
    const panel = await openFigures(user);

    expect(within(panel).getByText("Other adjustments")).toBeInTheDocument();
    expect(
      within(panel).getByText(figure(500n, "EUR", "exceptZero")),
    ).toBeInTheDocument();
  });

  it("put themselves away again", async () => {
    const user = show(LEDGER);
    await openFigures(user);
    await user.click(screen.getByRole("button", { name: FIGURES }));

    expect(screen.getByRole("button", { name: FIGURES })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("You were paid back")).not.toBeInTheDocument();
  });

  it("are not offered when there are none", () => {
    show(view({}));

    expect(
      screen.queryByRole("button", { name: FIGURES }),
    ).not.toBeInTheDocument();
  });
});

describe("one currency among several", () => {
  /**
   * In a group kept in separate currencies the sheet holds one of these per
   * currency, each fed its own ledger and headed by its code. The amounts
   * already carry the code; the one sentence with no amount in it names it.
   */
  it("heads the sentences with the currency, and names it where no amount does", () => {
    show(view({}, "USD"), { showCurrency: true });

    expect(screen.getByRole("heading", { name: "USD" })).toBeInTheDocument();
    expect(sentences()).toEqual([
      "You are not part of any expense in USD.",
      "So you are settled up.",
    ]);
  });

  it("writes every amount in that currency", () => {
    show(view({ paid: "9000", share: "3000" }, "CHF"), { showCurrency: true });

    expect(sentences()).toEqual([
      `You paid ${figure(9000n, "CHF")}. Your share was ${figure(3000n, "CHF")}.`,
      `So you get back ${figure(6000n, "CHF")}.`,
    ]);
  });

  it("shows no heading when it is the only one", () => {
    show(view({ paid: "9000", share: "3000" }));

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  /** Yen has no minor unit, so nothing in a sentence may invent one. */
  it("keeps a currency without decimals free of them", () => {
    show(view({ paid: "29000", share: "43667" }, "JPY"));

    expect(
      screen.getByText(`So you owe ${figure(14667n, "JPY")}.`),
    ).toBeInTheDocument();
    expect(figure(14667n, "JPY")).not.toMatch(/[.,]\d\d$/);
  });
});

describe("in French", () => {
  it("tells the same story in the reader's own language", async () => {
    const user = show(
      view({ paid: "9000", share: "3000", settlementsReceived: "1500" }),
      { locale: "fr" },
    );

    expect(sentences()).toEqual([
      `Tu as payé ${figure(9000n)}. Ta part était de ${figure(3000n)}.`,
      `On t’a remboursé ${figure(1500n)}.`,
      `Tu récupères donc ${figure(4500n)}.`,
    ]);

    const panel = await openFigures(user, /Les montants, ligne par ligne/);
    expect(within(panel).getByText("Dépenses")).toBeInTheDocument();
    expect(within(panel).getByText("Tu as payé")).toBeInTheDocument();
    expect(within(panel).getByText("Ta part")).toBeInTheDocument();
  });

  it("says a settled reader is à jour", () => {
    show(view({ paid: "3000", share: "3000" }), { locale: "fr" });

    expect(sentences()).toEqual([
      `Tu as payé ${figure(3000n)}, exactement ta part.`,
      "Tu es donc à jour.",
    ]);
  });
});
