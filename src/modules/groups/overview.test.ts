import { describe, expect, it } from "vitest";
import { counterpartiesOf, orderBalanceRows } from "./overview";
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

describe("ordering who owes whom", () => {
  it("puts the reader first, then creditors, then debtors", () => {
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
      "me",
      "jonas",
      "amelie",
      "padi",
    ]);
  });

  it("ranks each group by size, not by sign", () => {
    const rows = orderBalanceRows(
      balances([
        ["padi", -1000n],
        ["amelie", -8000n],
        ["jonas", 9000n],
      ]),
      NAMES,
      null,
    );

    expect(rows.map((row) => row.amount)).toEqual([9000n, -8000n, -1000n]);
  });

  /**
   * A settled member is not news on a screen about open debts, and on a big
   * group they would push the rows that matter past the five-row cap.
   */
  it("drops people who are square, including the reader", () => {
    const rows = orderBalanceRows(
      balances([
        ["me", 0n],
        ["quiet", 0n],
        ["jonas", 2500n],
      ]),
      NAMES,
      "me",
    );

    expect(rows.map((row) => row.participantId)).toEqual(["jonas"]);
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

    expect(rows[0]).toMatchObject({ isSelf: true, name: "Seb" });
    expect(rows[1]).toMatchObject({ isSelf: false, name: "Padi" });
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
