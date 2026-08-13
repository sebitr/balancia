import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BalanceError,
  balancesSumToZero,
  computeBalances,
  simplifyDebts,
  totalSpendByCurrency,
  type BalanceComputationInput,
  type ParticipantBalance,
} from "./engine";

const balancesFor = (
  input: BalanceComputationInput,
  currency: string,
): ParticipantBalance[] => {
  const result = computeBalances(input);
  const entry = result.find((item) => item.currency === currency);
  if (!entry) throw new Error(`No balances for ${currency}`);
  return [...entry.balances];
};

const amountsByParticipant = (
  balances: readonly ParticipantBalance[],
): Record<string, bigint> =>
  Object.fromEntries(
    balances.map((balance) => [balance.participantId, balance.amount]),
  );

describe("computeBalances — single payer", () => {
  it("credits the payer and debits everyone's share", () => {
    const balances = balancesFor(
      {
        participantIds: ["a", "b", "c"],
        expenses: [
          {
            id: "e1",
            currency: "EUR",
            payers: [{ participantId: "a", amount: 3000n }],
            shares: [
              { participantId: "a", amount: 1000n },
              { participantId: "b", amount: 1000n },
              { participantId: "c", amount: 1000n },
            ],
          },
        ],
        settlements: [],
      },
      "EUR",
    );
    expect(amountsByParticipant(balances)).toEqual({
      a: 2000n,
      b: -1000n,
      c: -1000n,
    });
    expect(balancesSumToZero(balances)).toBe(true);
  });
});

describe("computeBalances — multiple payers", () => {
  it("handles an expense funded by two people", () => {
    const balances = balancesFor(
      {
        participantIds: ["a", "b", "c", "d"],
        expenses: [
          {
            id: "e1",
            currency: "EUR",
            payers: [
              { participantId: "a", amount: 6000n },
              { participantId: "b", amount: 2000n },
            ],
            shares: [
              { participantId: "a", amount: 2000n },
              { participantId: "b", amount: 2000n },
              { participantId: "c", amount: 2000n },
              { participantId: "d", amount: 2000n },
            ],
          },
        ],
        settlements: [],
      },
      "EUR",
    );
    expect(amountsByParticipant(balances)).toEqual({
      a: 4000n,
      b: 0n,
      c: -2000n,
      d: -2000n,
    });
    expect(balancesSumToZero(balances)).toBe(true);
  });

  it("rejects an expense whose payers and shares disagree", () => {
    expect(() =>
      computeBalances({
        participantIds: ["a", "b"],
        expenses: [
          {
            id: "broken",
            currency: "EUR",
            payers: [{ participantId: "a", amount: 1000n }],
            shares: [{ participantId: "b", amount: 999n }],
          },
        ],
        settlements: [],
      }),
    ).toThrow(BalanceError);
  });
});

describe("computeBalances — settlements", () => {
  it("moves a debtor towards zero when they pay their creditor", () => {
    const input: BalanceComputationInput = {
      participantIds: ["a", "b"],
      expenses: [
        {
          id: "e1",
          currency: "EUR",
          payers: [{ participantId: "a", amount: 1000n }],
          shares: [
            { participantId: "a", amount: 500n },
            { participantId: "b", amount: 500n },
          ],
        },
      ],
      settlements: [
        {
          id: "s1",
          currency: "EUR",
          fromParticipantId: "b",
          toParticipantId: "a",
          amount: 500n,
        },
      ],
    };
    const balances = balancesFor(input, "EUR");
    expect(amountsByParticipant(balances)).toEqual({ a: 0n, b: 0n });
  });

  it("is not treated as a purchase — it never changes total spend", () => {
    const expenses = [
      {
        id: "e1",
        currency: "EUR",
        payers: [{ participantId: "a", amount: 1000n }],
        shares: [
          { participantId: "a", amount: 500n },
          { participantId: "b", amount: 500n },
        ],
      },
    ];
    expect(totalSpendByCurrency(expenses).get("EUR")).toBe(1000n);
  });

  it("rejects negative and self-directed settlements", () => {
    const base: BalanceComputationInput = {
      participantIds: ["a", "b"],
      expenses: [],
      settlements: [
        {
          id: "s1",
          currency: "EUR",
          fromParticipantId: "a",
          toParticipantId: "b",
          amount: -100n,
        },
      ],
    };
    expect(() => computeBalances(base)).toThrow(BalanceError);
    expect(() =>
      computeBalances({
        ...base,
        settlements: [
          {
            id: "s2",
            currency: "EUR",
            fromParticipantId: "a",
            toParticipantId: "a",
            amount: 100n,
          },
        ],
      }),
    ).toThrow(BalanceError);
  });
});

describe("computeBalances — separate currency mode", () => {
  it("keeps each currency independent", () => {
    const result = computeBalances({
      participantIds: ["a", "b"],
      expenses: [
        {
          id: "e1",
          currency: "EUR",
          payers: [{ participantId: "a", amount: 1000n }],
          shares: [
            { participantId: "a", amount: 500n },
            { participantId: "b", amount: 500n },
          ],
        },
        {
          id: "e2",
          currency: "JPY",
          payers: [{ participantId: "b", amount: 2000n }],
          shares: [
            { participantId: "a", amount: 1000n },
            { participantId: "b", amount: 1000n },
          ],
        },
      ],
      settlements: [],
    });

    expect(result.map((entry) => entry.currency)).toEqual(["EUR", "JPY"]);
    const eur = result.find((entry) => entry.currency === "EUR")!;
    const jpy = result.find((entry) => entry.currency === "JPY")!;
    expect(amountsByParticipant(eur.balances)).toEqual({ a: 500n, b: -500n });
    expect(amountsByParticipant(jpy.balances)).toEqual({ a: -1000n, b: 1000n });
    expect(balancesSumToZero(eur.balances)).toBe(true);
    expect(balancesSumToZero(jpy.balances)).toBe(true);
  });

  it("settles a currency without touching the other", () => {
    const result = computeBalances({
      participantIds: ["a", "b"],
      expenses: [
        {
          id: "e1",
          currency: "EUR",
          payers: [{ participantId: "a", amount: 1000n }],
          shares: [
            { participantId: "a", amount: 500n },
            { participantId: "b", amount: 500n },
          ],
        },
        {
          id: "e2",
          currency: "JPY",
          payers: [{ participantId: "a", amount: 1000n }],
          shares: [
            { participantId: "a", amount: 500n },
            { participantId: "b", amount: 500n },
          ],
        },
      ],
      settlements: [
        {
          id: "s1",
          currency: "EUR",
          fromParticipantId: "b",
          toParticipantId: "a",
          amount: 500n,
        },
      ],
    });
    const eur = result.find((entry) => entry.currency === "EUR")!;
    const jpy = result.find((entry) => entry.currency === "JPY")!;
    expect(amountsByParticipant(eur.balances)).toEqual({ a: 0n, b: 0n });
    expect(amountsByParticipant(jpy.balances)).toEqual({ a: 500n, b: -500n });
  });
});

describe("computeBalances — converted mode", () => {
  it("produces a single base-currency balance set", () => {
    // The caller has already converted every expense to EUR.
    const result = computeBalances({
      participantIds: ["a", "b"],
      expenses: [
        {
          id: "e1",
          currency: "EUR",
          payers: [{ participantId: "a", amount: 1000n }],
          shares: [
            { participantId: "a", amount: 500n },
            { participantId: "b", amount: 500n },
          ],
        },
        {
          id: "e2-was-usd",
          currency: "EUR",
          payers: [{ participantId: "b", amount: 909n }],
          shares: [
            { participantId: "a", amount: 455n },
            { participantId: "b", amount: 454n },
          ],
        },
      ],
      settlements: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].currency).toBe("EUR");
    expect(balancesSumToZero(result[0].balances)).toBe(true);
    expect(amountsByParticipant(result[0].balances)).toEqual({
      a: 45n,
      b: -45n,
    });
  });
});

describe("computeBalances — participants and determinism", () => {
  it("reports untouched participants as settled instead of omitting them", () => {
    const balances = balancesFor(
      {
        participantIds: ["a", "b", "quiet"],
        expenses: [
          {
            id: "e1",
            currency: "EUR",
            payers: [{ participantId: "a", amount: 1000n }],
            shares: [
              { participantId: "a", amount: 500n },
              { participantId: "b", amount: 500n },
            ],
          },
        ],
        settlements: [],
      },
      "EUR",
    );
    expect(balances).toHaveLength(3);
    expect(amountsByParticipant(balances).quiet).toBe(0n);
  });

  it("rejects references to participants outside the group", () => {
    expect(() =>
      computeBalances({
        participantIds: ["a"],
        expenses: [
          {
            id: "e1",
            currency: "EUR",
            payers: [{ participantId: "a", amount: 100n }],
            shares: [{ participantId: "stranger", amount: 100n }],
          },
        ],
        settlements: [],
      }),
    ).toThrow(BalanceError);
  });

  it("returns balances in the supplied participant order", () => {
    const balances = balancesFor(
      {
        participantIds: ["z", "y", "x"],
        expenses: [
          {
            id: "e1",
            currency: "EUR",
            payers: [{ participantId: "x", amount: 300n }],
            shares: [
              { participantId: "z", amount: 100n },
              { participantId: "y", amount: 100n },
              { participantId: "x", amount: 100n },
            ],
          },
        ],
        settlements: [],
      },
      "EUR",
    );
    expect(balances.map((balance) => balance.participantId)).toEqual([
      "z",
      "y",
      "x",
    ]);
  });
});

describe("balance invariants (property-based)", () => {
  const expenseArbitrary = (participantIds: readonly string[]) =>
    fc
      .record({
        id: fc.string({ minLength: 1, maxLength: 8 }),
        total: fc.bigInt({ min: 1n, max: 10n ** 8n }),
        payerCount: fc.integer({ min: 1, max: participantIds.length }),
        shareCount: fc.integer({ min: 1, max: participantIds.length }),
      })
      .map(({ id, total, payerCount, shareCount }) => {
        const splitInto = (count: number) => {
          const base = total / BigInt(count);
          const remainder = total - base * BigInt(count);
          return Array.from({ length: count }, (_, index) =>
            index === 0 ? base + remainder : base,
          );
        };
        return {
          id,
          currency: "EUR",
          payers: splitInto(payerCount).map((amount, index) => ({
            participantId: participantIds[index],
            amount,
          })),
          shares: splitInto(shareCount).map((amount, index) => ({
            participantId: participantIds[index],
            amount,
          })),
        };
      });

  it("always conserves money: balances sum to zero", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }).chain((count) => {
          const participantIds = Array.from(
            { length: count },
            (_, index) => `p${index}`,
          );
          return fc.record({
            participantIds: fc.constant(participantIds),
            expenses: fc.array(expenseArbitrary(participantIds), {
              maxLength: 12,
            }),
            settlements: fc.array(
              fc
                .record({
                  id: fc.string({ minLength: 1, maxLength: 8 }),
                  amount: fc.bigInt({ min: 0n, max: 10n ** 7n }),
                  from: fc.integer({ min: 0, max: count - 1 }),
                  offset: fc.integer({ min: 1, max: count - 1 }),
                })
                // `to` is derived from an offset so payer and recipient are
                // always distinct — a filter here would be unsatisfiable.
                .map(({ id, amount, from, offset }) => ({
                  id,
                  currency: "EUR",
                  fromParticipantId: participantIds[from],
                  toParticipantId: participantIds[(from + offset) % count],
                  amount,
                })),
              { maxLength: 8 },
            ),
          });
        }),
        (input) => {
          for (const currencyBalances of computeBalances(input)) {
            expect(balancesSumToZero(currencyBalances.balances)).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("simplifyDebts", () => {
  const balance = (
    participantId: string,
    amount: bigint,
  ): ParticipantBalance => ({ participantId, amount, currency: "EUR" });

  it("returns nothing when everyone is settled", () => {
    expect(simplifyDebts([balance("a", 0n), balance("b", 0n)])).toEqual([]);
  });

  it("produces a single transfer for a simple debt", () => {
    expect(simplifyDebts([balance("a", 1000n), balance("b", -1000n)])).toEqual([
      {
        fromParticipantId: "b",
        toParticipantId: "a",
        amount: 1000n,
        currency: "EUR",
      },
    ]);
  });

  it("clears a three-way circle with at most n-1 transfers", () => {
    const suggestions = simplifyDebts([
      balance("a", 2000n),
      balance("b", -1000n),
      balance("c", -1000n),
    ]);
    expect(suggestions).toHaveLength(2);
    expect(
      suggestions.every((suggestion) => suggestion.toParticipantId === "a"),
    ).toBe(true);
  });

  it("is deterministic for identical input", () => {
    const balances = [
      balance("a", 5000n),
      balance("b", -2000n),
      balance("c", -3000n),
      balance("d", 0n),
    ];
    expect(simplifyDebts(balances)).toEqual(simplifyDebts(balances));
  });

  it("rejects mixed currencies", () => {
    expect(() =>
      simplifyDebts([
        balance("a", 100n),
        { participantId: "b", amount: -100n, currency: "USD" },
      ]),
    ).toThrow(BalanceError);
  });

  it("settles every balance and never exceeds n-1 transfers", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.bigInt({ min: -(10n ** 7n), max: 10n ** 7n }), {
            minLength: 2,
            maxLength: 12,
          })
          .map((amounts) => {
            // Force the set to sum to zero, as real balances always do.
            const total = amounts.reduce(
              (accumulator, amount) => accumulator + amount,
              0n,
            );
            const adjusted = [...amounts];
            adjusted[0] -= total;
            return adjusted.map((amount, index) =>
              balance(`p${index}`, amount),
            );
          }),
        (balances) => {
          const suggestions = simplifyDebts(balances);
          expect(suggestions.length).toBeLessThanOrEqual(balances.length - 1);

          // Applying the suggestions must settle everyone.
          const net = new Map(
            balances.map((entry) => [entry.participantId, entry.amount]),
          );
          for (const suggestion of suggestions) {
            expect(suggestion.amount > 0n).toBe(true);
            net.set(
              suggestion.fromParticipantId,
              (net.get(suggestion.fromParticipantId) ?? 0n) + suggestion.amount,
            );
            net.set(
              suggestion.toParticipantId,
              (net.get(suggestion.toParticipantId) ?? 0n) - suggestion.amount,
            );
          }
          for (const remaining of net.values()) {
            expect(remaining).toBe(0n);
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});
