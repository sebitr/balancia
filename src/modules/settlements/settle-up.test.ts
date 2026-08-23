import { describe, expect, it } from "vitest";
import { groupTransfers } from "./settle-up";
import type { RepaymentSuggestion } from "@/modules/balances/engine";

/**
 * The grouping the settle-up screen depends on.
 *
 * The engine's own order follows its greedy walk, which is deterministic but
 * is not an order anybody reads in. What this module owes the screen is the
 * order a person expects — what they owe, then what they are owed, then
 * everyone else's business — and a stable one, because two equal transfers
 * that swap places between renders look like the plan changed.
 */

const NAMES = new Map([
  ["seb", "Seb"],
  ["amelie", "Amélie"],
  ["ravi", "Ravi"],
  ["lena", "Lena"],
  ["jonas", "Jonas"],
]);

function transfer(
  from: string,
  to: string,
  amount: bigint,
  currency = "EUR",
): RepaymentSuggestion {
  return {
    fromParticipantId: from,
    toParticipantId: to,
    amount,
    currency,
  };
}

const sentence = (entry: { fromName: string; toName: string }): string =>
  `${entry.fromName} pays ${entry.toName}`;

describe("grouping one currency's transfers", () => {
  it("puts what you owe before what you are owed", () => {
    const grouped = groupTransfers(
      "EUR",
      [transfer("ravi", "seb", 6200n), transfer("seb", "amelie", 14860n)],
      NAMES,
      "seb",
    );

    expect(grouped.yours.map(sentence)).toEqual([
      "Seb pays Amélie",
      "Ravi pays Seb",
    ]);
    expect(grouped.others).toEqual([]);
  });

  it("keeps transfers between other people out of yours", () => {
    const grouped = groupTransfers(
      "EUR",
      [
        transfer("seb", "amelie", 14860n),
        transfer("ravi", "amelie", 9940n),
        transfer("lena", "jonas", 3210n),
      ],
      NAMES,
      "seb",
    );

    expect(grouped.yours.map(sentence)).toEqual(["Seb pays Amélie"]);
    expect(grouped.others.map(sentence)).toEqual([
      "Ravi pays Amélie",
      "Lena pays Jonas",
    ]);
  });

  it("orders each group largest first", () => {
    const grouped = groupTransfers(
      "EUR",
      [transfer("lena", "jonas", 3210n), transfer("ravi", "amelie", 9940n)],
      NAMES,
      "seb",
    );

    expect(grouped.others.map((entry) => entry.amount)).toEqual([9940n, 3210n]);
  });

  it("breaks ties by the order the engine emitted them", () => {
    const grouped = groupTransfers(
      "EUR",
      [transfer("ravi", "amelie", 5000n), transfer("lena", "jonas", 5000n)],
      NAMES,
      "seb",
    );

    expect(grouped.others.map(sentence)).toEqual([
      "Ravi pays Amélie",
      "Lena pays Jonas",
    ]);
  });

  it("marks both directions the reader is part of", () => {
    const grouped = groupTransfers(
      "EUR",
      [transfer("seb", "amelie", 14860n), transfer("ravi", "seb", 6200n)],
      NAMES,
      "seb",
    );

    expect(grouped.yours[0]).toMatchObject({
      fromIsSelf: true,
      toIsSelf: false,
    });
    expect(grouped.yours[1]).toMatchObject({
      fromIsSelf: false,
      toIsSelf: true,
    });
  });

  it("gives a guest with no participant row nothing of their own", () => {
    const grouped = groupTransfers(
      "EUR",
      [transfer("seb", "amelie", 14860n), transfer("lena", "jonas", 3210n)],
      NAMES,
      null,
    );

    expect(grouped.yours).toEqual([]);
    expect(grouped.others).toHaveLength(2);
  });

  it("reports a settled currency as an empty pair rather than a zero", () => {
    const grouped = groupTransfers("GBP", [], NAMES, "seb");

    expect(grouped).toEqual({ currency: "GBP", yours: [], others: [] });
  });
});
