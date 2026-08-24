import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BalanceError,
  balancesSumToZero,
  computeBalances,
  contributionsOf,
  revenuesOf,
  simplifyDebts,
  totalSpendByCurrency,
  type BalanceComputationInput,
  type BalanceInputExpense,
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

describe("contributionsOf", () => {
  const expenses: BalanceInputExpense[] = [
    {
      id: "dinner",
      currency: "EUR",
      payers: [{ participantId: "a", amount: 9000n }],
      shares: [
        { participantId: "a", amount: 3000n },
        { participantId: "b", amount: 3000n },
        { participantId: "c", amount: 3000n },
      ],
    },
    {
      id: "taxi",
      currency: "EUR",
      payers: [{ participantId: "b", amount: 2000n }],
      shares: [
        { participantId: "a", amount: 1000n },
        { participantId: "b", amount: 1000n },
      ],
    },
    {
      id: "ferry",
      currency: "CHF",
      payers: [{ participantId: "a", amount: 5000n }],
      shares: [
        { participantId: "a", amount: 2500n },
        { participantId: "b", amount: 2500n },
      ],
    },
  ];

  it("separates what someone put in from what was theirs to carry", () => {
    expect(contributionsOf(expenses, "a").get("EUR")).toEqual({
      paid: 9000n,
      share: 4000n,
    });
  });

  /**
   * The pair is what explains a balance: paid minus share *is* the position,
   * and showing both is the difference between a number and a reason.
   */
  it("agrees with the balance the engine computes", () => {
    const contribution = contributionsOf(expenses, "b").get("EUR");
    const balance = balancesFor(
      { participantIds: ["a", "b", "c"], expenses, settlements: [] },
      "EUR",
    ).find((row) => row.participantId === "b");

    expect(contribution).toBeDefined();
    expect(balance?.amount).toBe(contribution!.paid - contribution!.share);
  });

  it("keeps each currency apart", () => {
    const totals = contributionsOf(expenses, "a");
    expect(totals.get("CHF")).toEqual({ paid: 5000n, share: 2500n });
    expect([...totals.keys()].sort()).toEqual(["CHF", "EUR"]);
  });

  it("reports nothing for someone with no part in any expense", () => {
    expect(contributionsOf(expenses, "nobody").size).toBe(0);
  });

  it("counts a share without a payment", () => {
    expect(contributionsOf(expenses, "c").get("EUR")).toEqual({
      paid: 0n,
      share: 3000n,
    });
  });
});

describe("computeBalances — income", () => {
  /**
   * The mirror image of the single-payer case above: 3000 received and split
   * three ways leaves the receiver 2000 down instead of 2000 up.
   */
  it("puts the receiver in debt and credits everyone else", () => {
    const balances = balancesFor(
      {
        participantIds: ["a", "b", "c"],
        expenses: [
          {
            id: "rent",
            currency: "EUR",
            direction: "in",
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
      a: -2000n,
      b: 1000n,
      c: 1000n,
    });
    expect(balancesSumToZero(balances)).toBe(true);
  });

  /** "Mine only — credit Seb": recorded, but nobody else's balance moves. */
  it("moves nobody when the income is credited to one person", () => {
    const balances = balancesFor(
      {
        participantIds: ["a", "b", "c"],
        expenses: [
          {
            id: "salary",
            currency: "EUR",
            direction: "in",
            payers: [{ participantId: "a", amount: 240000n }],
            shares: [{ participantId: "a", amount: 240000n }],
          },
        ],
        settlements: [],
      },
      "EUR",
    );
    expect(amountsByParticipant(balances)).toEqual({ a: 0n, b: 0n, c: 0n });
  });

  it("cancels an identical expense out", () => {
    const shares = [
      { participantId: "a", amount: 1000n },
      { participantId: "b", amount: 1000n },
    ];
    const balances = balancesFor(
      {
        participantIds: ["a", "b"],
        expenses: [
          {
            id: "paid",
            currency: "EUR",
            payers: [{ participantId: "a", amount: 2000n }],
            shares,
          },
          {
            id: "refunded",
            currency: "EUR",
            direction: "in",
            payers: [{ participantId: "a", amount: 2000n }],
            shares,
          },
        ],
        settlements: [],
      },
      "EUR",
    );
    expect(amountsByParticipant(balances)).toEqual({ a: 0n, b: 0n });
  });

  it("treats an absent direction as spending", () => {
    const expense: BalanceInputExpense = {
      id: "e1",
      currency: "EUR",
      payers: [{ participantId: "a", amount: 2000n }],
      shares: [
        { participantId: "a", amount: 1000n },
        { participantId: "b", amount: 1000n },
      ],
    };
    const withDirection = balancesFor(
      {
        participantIds: ["a", "b"],
        expenses: [{ ...expense, direction: "out" }],
        settlements: [],
      },
      "EUR",
    );
    const without = balancesFor(
      { participantIds: ["a", "b"], expenses: [expense], settlements: [] },
      "EUR",
    );
    expect(amountsByParticipant(without)).toEqual(
      amountsByParticipant(withDirection),
    );
  });

  it("still rejects an unbalanced entry", () => {
    expect(() =>
      computeBalances({
        participantIds: ["a", "b"],
        expenses: [
          {
            id: "bad",
            currency: "EUR",
            direction: "in",
            payers: [{ participantId: "a", amount: 2000n }],
            shares: [{ participantId: "b", amount: 1500n }],
          },
        ],
        settlements: [],
      }),
    ).toThrow(BalanceError);
  });
});

describe("spending statistics exclude income", () => {
  const entries: BalanceInputExpense[] = [
    {
      id: "groceries",
      currency: "EUR",
      payers: [{ participantId: "a", amount: 6000n }],
      shares: [
        { participantId: "a", amount: 3000n },
        { participantId: "b", amount: 3000n },
      ],
    },
    {
      id: "rent-received",
      currency: "EUR",
      direction: "in",
      payers: [{ participantId: "a", amount: 240000n }],
      shares: [
        { participantId: "a", amount: 120000n },
        { participantId: "b", amount: 120000n },
      ],
    },
  ];

  /**
   * A month with heavy spending and one large rent cheque is not a quiet
   * month, and netting the two would report it as one.
   */
  it("leaves income out of total spend", () => {
    expect(totalSpendByCurrency(entries).get("EUR")).toBe(6000n);
  });

  it("leaves income out of what someone paid and carried", () => {
    expect(contributionsOf(entries, "a").get("EUR")).toEqual({
      paid: 6000n,
      share: 3000n,
    });
  });
});

describe("revenuesOf", () => {
  const entries: BalanceInputExpense[] = [
    {
      id: "chalet-week",
      currency: "CHF",
      direction: "in",
      payers: [{ participantId: "a", amount: 310000n }],
      shares: [
        { participantId: "a", amount: 100000n },
        { participantId: "b", amount: 100000n },
        { participantId: "c", amount: 110000n },
      ],
    },
    {
      id: "deposit-returned",
      currency: "CHF",
      direction: "in",
      payers: [{ participantId: "b", amount: 40000n }],
      shares: [
        { participantId: "a", amount: 20000n },
        { participantId: "b", amount: 20000n },
      ],
    },
    {
      id: "firewood",
      currency: "CHF",
      payers: [{ participantId: "a", amount: 9000n }],
      shares: [
        { participantId: "a", amount: 4500n },
        { participantId: "b", amount: 4500n },
      ],
    },
    {
      id: "ferry-refund",
      currency: "EUR",
      direction: "in",
      payers: [{ participantId: "a", amount: 5000n }],
      shares: [
        { participantId: "a", amount: 2500n },
        { participantId: "b", amount: 2500n },
      ],
    },
  ];

  it("separates what came in through someone from what is theirs", () => {
    expect(revenuesOf(entries, "a").get("CHF")).toEqual({
      received: 310000n,
      credited: 120000n,
    });
  });

  /**
   * The mirror of `contributionsOf`'s own agreement test. Money held on the
   * group's behalf lowers a balance, so the pair explains a position as
   * `credited - received` rather than `paid - share`.
   */
  it("agrees with the balance the engine computes", () => {
    const income = entries.filter((entry) => entry.direction === "in");
    const revenue = revenuesOf(income, "a").get("CHF");
    const balance = balancesFor(
      { participantIds: ["a", "b", "c"], expenses: income, settlements: [] },
      "CHF",
    ).find((row) => row.participantId === "a");

    expect(revenue).toBeDefined();
    expect(balance?.amount).toBe(revenue!.credited - revenue!.received);
  });

  it("leaves spending out, exactly as contributionsOf leaves income out", () => {
    // `firewood` is the only entry in the list that is not income.
    expect(revenuesOf(entries, "a").get("CHF")).toEqual({
      received: 310000n,
      credited: 120000n,
    });
    expect(contributionsOf(entries, "a").get("CHF")).toEqual({
      paid: 9000n,
      share: 4500n,
    });
  });

  it("keeps each currency apart", () => {
    const totals = revenuesOf(entries, "a");
    expect(totals.get("EUR")).toEqual({ received: 5000n, credited: 2500n });
    expect([...totals.keys()].sort()).toEqual(["CHF", "EUR"]);
  });

  it("reports nothing for someone with no part in any income", () => {
    expect(revenuesOf(entries, "nobody").size).toBe(0);
  });

  it("counts a credit without a collection", () => {
    expect(revenuesOf(entries, "c").get("CHF")).toEqual({
      received: 0n,
      credited: 110000n,
    });
  });

  /** An entry with no direction is spending, so income never claims it. */
  it("treats an absent direction as spending", () => {
    const legacy: BalanceInputExpense[] = [
      {
        id: "before-income-existed",
        currency: "EUR",
        payers: [{ participantId: "a", amount: 1000n }],
        shares: [{ participantId: "a", amount: 1000n }],
      },
    ];
    expect(revenuesOf(legacy, "a").size).toBe(0);
    expect(contributionsOf(legacy, "a").get("EUR")).toEqual({
      paid: 1000n,
      share: 1000n,
    });
  });
});

describe("the two tallies account for every entry (property-based)", () => {
  /**
   * The claim the position sheet makes.
   *
   * It tells the reader their balance is expenses plus revenue plus
   * repayments, with nothing left over. That is only true if spending and
   * income between them cover every entry in the group — so this generates
   * groups of both directions, in two currencies, and checks that
   * `paid - share + credited - received + settlementsPaid - settlementsReceived`
   * reproduces the engine's balance exactly, for every participant.
   */
  const entryArbitrary = (participantIds: readonly string[]) =>
    fc
      .record({
        id: fc.string({ minLength: 1, maxLength: 8 }),
        currency: fc.constantFrom("EUR", "CHF"),
        direction: fc.constantFrom<"out" | "in" | undefined>(
          "out",
          "in",
          undefined,
        ),
        total: fc.bigInt({ min: 1n, max: 10n ** 8n }),
        payerCount: fc.integer({ min: 1, max: participantIds.length }),
        shareCount: fc.integer({ min: 1, max: participantIds.length }),
      })
      .map(({ id, currency, direction, total, payerCount, shareCount }) => {
        const splitInto = (count: number) => {
          const base = total / BigInt(count);
          const remainder = total - base * BigInt(count);
          return Array.from({ length: count }, (_, index) =>
            index === 0 ? base + remainder : base,
          );
        };
        return {
          id,
          currency,
          direction,
          payers: splitInto(payerCount).map((amount, index) => ({
            participantId: participantIds[index],
            amount,
          })),
          shares: splitInto(shareCount).map((amount, index) => ({
            participantId: participantIds[index],
            amount,
          })),
        } satisfies BalanceInputExpense;
      });

  it("leaves no part of any balance unexplained", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }).chain((count) => {
          const participantIds = Array.from(
            { length: count },
            (_, index) => `p${index}`,
          );
          return fc.record({
            participantIds: fc.constant(participantIds),
            expenses: fc.array(entryArbitrary(participantIds), {
              maxLength: 10,
            }),
            settlements: fc.array(
              fc
                .record({
                  id: fc.string({ minLength: 1, maxLength: 8 }),
                  currency: fc.constantFrom("EUR", "CHF"),
                  amount: fc.bigInt({ min: 0n, max: 10n ** 7n }),
                  from: fc.integer({ min: 0, max: count - 1 }),
                  offset: fc.integer({ min: 1, max: count - 1 }),
                })
                .map(({ id, currency, amount, from, offset }) => ({
                  id,
                  currency,
                  fromParticipantId: participantIds[from],
                  toParticipantId: participantIds[(from + offset) % count],
                  amount,
                })),
              { maxLength: 6 },
            ),
          });
        }),
        (input) => {
          for (const entry of computeBalances(input)) {
            for (const balance of entry.balances) {
              const who = balance.participantId;
              const contribution = contributionsOf(input.expenses, who).get(
                entry.currency,
              );
              const revenue = revenuesOf(input.expenses, who).get(
                entry.currency,
              );
              const settled = input.settlements.filter(
                (settlement) => settlement.currency === entry.currency,
              );
              const settlementsPaid = settled
                .filter((settlement) => settlement.fromParticipantId === who)
                .reduce((sum, settlement) => sum + settlement.amount, 0n);
              const settlementsReceived = settled
                .filter((settlement) => settlement.toParticipantId === who)
                .reduce((sum, settlement) => sum + settlement.amount, 0n);

              const explained =
                (contribution?.paid ?? 0n) -
                (contribution?.share ?? 0n) +
                (revenue?.credited ?? 0n) -
                (revenue?.received ?? 0n) +
                settlementsPaid -
                settlementsReceived;

              expect(explained).toBe(balance.amount);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
