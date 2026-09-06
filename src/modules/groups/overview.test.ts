import { describe, expect, it } from "vitest";
import {
  counterpartiesOf,
  isMultiCurrency,
  mainCurrencyOf,
  orderBalanceRows,
  positionBreakdownOf,
  spendingPeriodsOf,
  type CurrencyOverview,
  type SettlementSuggestion,
} from "./overview";
import type { CurrencyBalances } from "@/modules/balances/engine";

const NAMES = new Map([
  ["me", "Seb"],
  ["padi", "Padi"],
  ["jonas", "Jonas"],
  ["amelie", "Amélie"],
  ["quiet", "Robin"],
]);

function balances(entries: readonly [string, bigint][]): CurrencyBalances {
  return {
    currency: "EUR",
    balances: entries.map(([participantId, amount]) => ({
      participantId,
      amount,
      currency: "EUR",
    })),
    totalOutstanding: entries
      .map(([, amount]) => amount)
      .filter((amount) => amount > 0n)
      .reduce((total, amount) => total + amount, 0n),
  };
}

describe("ordering everyone's balances", () => {
  it("puts the most negative balance first and the most positive last", () => {
    const rows = orderBalanceRows(
      balances([
        ["padi", -4000n],
        ["jonas", 9000n],
        ["me", 5000n],
        ["amelie", -10000n],
      ]),
      NAMES,
      "me",
    );

    expect(rows.map((row) => row.participantId)).toEqual([
      "amelie",
      "padi",
      "me",
      "jonas",
    ]);
  });

  it("sorts by signed position rather than magnitude", () => {
    const rows = orderBalanceRows(
      balances([
        ["padi", -1000n],
        ["amelie", -8000n],
        ["jonas", 9000n],
      ]),
      NAMES,
      null,
    );

    expect(rows.map((row) => row.amount)).toEqual([-8000n, -1000n, 9000n]);
  });

  it("keeps settled people in the group comparison", () => {
    const rows = orderBalanceRows(
      balances([
        ["me", 0n],
        ["quiet", 0n],
        ["jonas", 2500n],
      ]),
      NAMES,
      "me",
    );

    expect(rows.map((row) => row.participantId)).toEqual([
      "me",
      "quiet",
      "jonas",
    ]);
  });

  it("marks the reader's own row and names everyone else", () => {
    const rows = orderBalanceRows(
      balances([
        ["me", 5000n],
        ["padi", -5000n],
      ]),
      NAMES,
      "me",
    );

    expect(rows[0]).toMatchObject({ isSelf: false, name: "Padi" });
    expect(rows[1]).toMatchObject({ isSelf: true, name: "Seb" });
  });
});

describe("spending periods", () => {
  const expense = (
    id: string,
    expenseDate: string,
    amount: bigint,
    payer: string,
    share: bigint,
  ) => ({
    id,
    expenseDate,
    currency: "EUR",
    direction: "out" as const,
    payers: [{ participantId: payer, amount }],
    shares: [{ participantId: "me", amount: share }],
  });

  it("keeps month and last-settlement views on the group calendar", () => {
    const periods = spendingPeriodsOf(
      [
        expense("june", "2026-06-10", 30000n, "me", 15000n),
        expense("july", "2026-07-12", 10000n, "me", 5000n),
        expense("august", "2026-08-14", 20000n, "other", 10000n),
      ],
      "me",
      "Europe/Zurich",
      "2026-08-10",
      new Date("2026-08-17T12:00:00Z"),
    );

    const thisMonth = periods.find((period) => period.key === "thisMonth");
    const lastMonth = periods.find((period) => period.key === "lastMonth");
    const since = periods.find(
      (period) => period.key === "sinceLastSettlement",
    );
    const allTime = periods.find((period) => period.key === "allTime");

    expect(thisMonth?.stats[0]).toMatchObject({
      groupSpent: 20000n,
      youPaid: 0n,
      yourShare: 10000n,
    });
    expect(lastMonth?.stats[0]).toMatchObject({
      groupSpent: 10000n,
      youPaid: 10000n,
      yourShare: 5000n,
    });
    expect(since?.stats).toEqual(thisMonth?.stats);
    expect(allTime?.stats[0].groupSpent).toBe(60000n);
  });
});

describe("the counterparties behind a position", () => {
  it("names who would pay the reader, largest first", () => {
    const parties = counterpartiesOf(
      [
        {
          fromParticipantId: "padi",
          toParticipantId: "me",
          amount: 4000n,
          currency: "EUR",
        },
        {
          fromParticipantId: "jonas",
          toParticipantId: "me",
          amount: 20800n,
          currency: "EUR",
        },
      ],
      "me",
      NAMES,
    );

    expect(parties.map((party) => party.name)).toEqual(["Jonas", "Padi"]);
    expect(parties[0].amount).toBe(20800n);
  });

  it("names who the reader would pay when they are the debtor", () => {
    const parties = counterpartiesOf(
      [
        {
          fromParticipantId: "me",
          toParticipantId: "amelie",
          amount: 4000n,
          currency: "EUR",
        },
      ],
      "me",
      NAMES,
    );

    expect(parties).toEqual([
      { participantId: "amelie", name: "Amélie", amount: 4000n },
    ]);
  });

  it("ignores debts the reader is not part of", () => {
    const parties = counterpartiesOf(
      [
        {
          fromParticipantId: "padi",
          toParticipantId: "jonas",
          amount: 4000n,
          currency: "EUR",
        },
      ],
      "me",
      NAMES,
    );

    expect(parties).toEqual([]);
  });
});

describe("the ledger behind a position", () => {
  /**
   * The figures the position sheet was designed against: a chalet group that
   * collects rental income, where the reader paid most of the bills, took the
   * bookings, and has already been repaid nearly all of it.
   */
  const CHALET = {
    contribution: { paid: 31634847n, share: 12454808n },
    revenue: { received: 3100000n, credited: 390235n },
    settlement: { paid: 2671n, received: 15162412n },
  };

  it("sums to the balance it is explaining, with nothing left over", () => {
    const breakdown = positionBreakdownOf(1310533n, CHALET);

    expect(breakdown.paid - breakdown.share).toBe(19180039n);
    expect(breakdown.revenueCredited - breakdown.revenueReceived).toBe(
      -2709765n,
    );
    expect(breakdown.settlementsPaid - breakdown.settlementsReceived).toBe(
      -15159741n,
    );
    expect(breakdown.otherAdjustments).toBe(0n);
  });

  /**
   * The sign rule the copy depends on. Collecting money for the group is an
   * expense run backwards: it lowers the collector's balance, and the part
   * credited to them raises it.
   */
  it("has income lower a balance and a credit raise it", () => {
    const collected = positionBreakdownOf(-2709765n, {
      revenue: CHALET.revenue,
    });

    expect(collected.revenueReceived).toBe(3100000n);
    expect(collected.revenueCredited).toBe(390235n);
    expect(collected.otherAdjustments).toBe(0n);
  });

  it("explains a position made only of repayments", () => {
    const breakdown = positionBreakdownOf(-5000n, {
      settlement: { paid: 1000n, received: 6000n },
    });

    expect(breakdown.paid).toBe(0n);
    expect(breakdown.revenueReceived).toBe(0n);
    expect(breakdown.otherAdjustments).toBe(0n);
  });

  /**
   * A participant with no activity at all is settled, and the sheet says so
   * with seven zeros rather than with a remainder it cannot name.
   */
  it("reports zeros, not a remainder, for someone with nothing recorded", () => {
    expect(positionBreakdownOf(0n, {})).toEqual({
      paid: 0n,
      share: 0n,
      revenueReceived: 0n,
      revenueCredited: 0n,
      settlementsPaid: 0n,
      settlementsReceived: 0n,
      otherAdjustments: 0n,
    });
  });

  /**
   * The remainder is the reason a fourth kind of entry could not go missing
   * from this sheet the way income once did: whatever the three pairs fail to
   * explain still shows up, as its own row, rather than being absorbed.
   */
  it("keeps whatever the three pairs cannot explain", () => {
    const breakdown = positionBreakdownOf(20000n, {
      contribution: { paid: 15000n, share: 5000n },
    });

    expect(breakdown.otherAdjustments).toBe(10000n);
  });

  it("carries a remainder in either direction", () => {
    expect(
      positionBreakdownOf(-100n, {
        contribution: { paid: 900n, share: 400n },
      }).otherAdjustments,
    ).toBe(-600n);
  });
});

/**
 * Which row the overview lands open on.
 *
 * The choice is deliberately one function, so that a change of mind is a
 * change here and nowhere else. It shipped as the group's base currency,
 * which on a trip kept in EUR with one stray USD debt opened a row saying
 * everyone was square — so the row with money outstanding in it wins now,
 * the reader's own first, and the base currency only settles ties.
 */
const TRANSFER: SettlementSuggestion = {
  fromParticipantId: "padi",
  fromName: "Padi",
  toParticipantId: "me",
  toName: "Seb",
  currency: "EUR",
  amount: 100n,
  fromIsSelf: false,
  toIsSelf: true,
};

const entry = (
  currency: string,
  totalSpent: bigint,
  outstanding: { position?: bigint; transfers?: number } = {},
): CurrencyOverview => ({
  currency,
  totalSpent,
  expenseCount: 1,
  position: outstanding.position ?? 0n,
  members: [],
  transfers: Array.from({ length: outstanding.transfers ?? 0 }, () => ({
    ...TRANSFER,
    currency,
  })),
});

/**
 * Which of the two overviews a group gets.
 *
 * The collapsed-per-currency screen answers a problem a one-currency group
 * does not have, so it is gated on the money rather than on configuration —
 * and these hold the two ways a group can be single-currency without being
 * configured that way.
 */
describe("isMultiCurrency", () => {
  it("keeps the hero for a group converted to a single currency", () => {
    expect(isMultiCurrency([entry("CHF", 35000n)])).toBe(false);
  });

  /**
   * A group kept in separate currencies that has so far only spent in one.
   * It is a one-currency group today, and becomes the other kind by itself
   * the moment a second currency arrives — no setting changes hands.
   */
  it("keeps the hero until a second currency actually has activity", () => {
    expect(isMultiCurrency([entry("CHF", 35000n)])).toBe(false);
    expect(isMultiCurrency([entry("CHF", 35000n), entry("EUR", 2600n)])).toBe(
      true,
    );
  });

  it("has no second screen to offer an empty group", () => {
    expect(isMultiCurrency([])).toBe(false);
  });
});

describe("mainCurrencyOf", () => {
  /** Lisbon Trip: kept in EUR, everyone square in it, one debt in USD. */
  it("opens the currency the reader is not square in, over the base one", () => {
    const currencies = [
      entry("EUR", 11790n),
      entry("USD", 1332n, { position: 888n, transfers: 2 }),
    ];

    expect(mainCurrencyOf(currencies, "EUR")).toBe("USD");
  });

  it("opens a currency other people still owe in, over a level one", () => {
    const currencies = [
      entry("EUR", 11790n),
      entry("USD", 1332n, { transfers: 1 }),
    ];

    expect(mainCurrencyOf(currencies, "EUR")).toBe("USD");
  });

  it("settles a tie between two live currencies on the base currency", () => {
    const currencies = [
      entry("USD", 90000n, { position: 100n, transfers: 1 }),
      entry("CHF", 35000n, { position: -100n, transfers: 1 }),
    ];

    expect(mainCurrencyOf(currencies, "CHF")).toBe("CHF");
  });

  it("opens the group's base currency when every currency is level", () => {
    const currencies = [entry("USD", 90000n), entry("CHF", 35000n)];

    expect(mainCurrencyOf(currencies, "CHF")).toBe("CHF");
  });

  it("falls back to the most-spent currency when no base is named", () => {
    const currencies = [entry("CHF", 35000n), entry("USD", 90000n)];

    expect(mainCurrencyOf(currencies, null)).toBe("USD");
  });

  /** A base currency the group has never actually spent in names no row. */
  it("falls back when the base currency has no activity", () => {
    const currencies = [entry("CHF", 35000n), entry("USD", 90000n)];

    expect(mainCurrencyOf(currencies, "GBP")).toBe("USD");
  });

  it("has nothing to open in a group with no currencies", () => {
    expect(mainCurrencyOf([], "CHF")).toBeNull();
  });
});
