import { describe, expect, it } from "vitest";
import {
  counterpartiesOf,
  orderBalanceRows,
  spendingPeriodsOf,
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
