import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { balancesSumToZero } from "./engine";
import { assembleBalances, type BalanceRows } from "./service";

/**
 * Which currency a converted group books each row in.
 *
 * The engine is tested on its own; what is tested here is the choice made
 * before it runs. A converted group books a row in its base currency when it
 * can say what the row is worth there — written in the base, or carrying a
 * frozen conversion — and otherwise leaves it in its own. That second case is
 * what an import or a restored backup writes, and it used to be counted in the
 * base at face value: 30 000 yen as 30 000 euros.
 */

const AIKO = "aiko";
const BEN = "ben";

const converted = {
  id: "group",
  currencyMode: "converted",
  baseCurrency: "EUR",
} as const;
const separate = {
  id: "group",
  currencyMode: "separate",
  baseCurrency: null,
} as const;

type Row = BalanceRows["expenses"][number];
type Allocation = BalanceRows["payers"][number];

/**
 * One expense Aiko paid for and split evenly with Ben, as the database would
 * hand it back — with converted figures only when a rate was recorded.
 */
function expense(
  id: string,
  currency: string,
  amount: bigint,
  conversion: { currency: string; amount: bigint } | null = null,
): {
  expense: Row;
  payers: Allocation[];
  shares: Allocation[];
} {
  const half = amount / 2n;
  const convertedHalf = conversion ? conversion.amount / 2n : null;
  return {
    expense: {
      id,
      direction: "out",
      expenseDate: "2026-09-01",
      currency,
      convertedCurrency: conversion?.currency ?? null,
    },
    payers: [
      {
        expenseId: id,
        participantId: AIKO,
        amount,
        convertedAmount: conversion?.amount ?? null,
      },
    ],
    shares: [
      {
        expenseId: id,
        participantId: AIKO,
        amount: half,
        convertedAmount: convertedHalf,
      },
      {
        expenseId: id,
        participantId: BEN,
        amount: amount - half,
        convertedAmount:
          conversion && convertedHalf !== null
            ? conversion.amount - convertedHalf
            : null,
      },
    ],
  };
}

function rowsOf(
  entries: ReturnType<typeof expense>[],
  settlements: BalanceRows["settlements"] = [],
): BalanceRows {
  return {
    participants: [
      { id: AIKO, displayName: "Aiko" },
      { id: BEN, displayName: "Ben" },
    ],
    expenses: entries.map((entry) => entry.expense),
    payers: entries.flatMap((entry) => entry.payers),
    shares: entries.flatMap((entry) => entry.shares),
    settlements,
  };
}

function balanceOf(
  result: ReturnType<typeof assembleBalances>,
  currency: string,
): Record<string, bigint> {
  const entry = result.currencies.find((one) => one.currency === currency);
  return Object.fromEntries(
    (entry?.balances ?? []).map((balance) => [
      balance.participantId,
      balance.amount,
    ]),
  );
}

describe("assembleBalances in a converted group", () => {
  it("keeps a foreign row with no rate in a balance list of its own", () => {
    // Dinner €60.00 in the base, and a ryokan imported from Splitwise:
    // ¥30 000, no rate. JPY has no minor unit, so 30000 is thirty thousand yen.
    const result = assembleBalances(
      converted,
      rowsOf([
        expense("dinner", "EUR", 6000n),
        expense("ryokan", "JPY", 30000n),
      ]),
      null,
    );

    expect(result.currencies.map((entry) => entry.currency)).toEqual([
      "EUR",
      "JPY",
    ]);
    // The euro list is the dinner and nothing else — before, it was the dinner
    // plus 30000 read as cents: Aiko +€180.00 instead of +€30.00.
    expect(balanceOf(result, "EUR")).toEqual({ [AIKO]: 3000n, [BEN]: -3000n });
    expect(balanceOf(result, "JPY")).toEqual({
      [AIKO]: 15000n,
      [BEN]: -15000n,
    });
    for (const entry of result.currencies) {
      expect(balancesSumToZero(entry.balances)).toBe(true);
      expect(entry.balances.every((b) => b.currency === entry.currency)).toBe(
        true,
      );
    }

    expect(result.suggestionsByCurrency.get("JPY")).toEqual([
      {
        fromParticipantId: BEN,
        toParticipantId: AIKO,
        amount: 15000n,
        currency: "JPY",
      },
    ]);
    expect(result.totalSpend.get("EUR")).toBe(6000n);
    expect(result.totalSpend.get("JPY")).toBe(30000n);
    expect(
      result.spendingFacts.find((fact) => fact.id === "ryokan")?.currency,
    ).toBe("JPY");
  });

  it("books a foreign row that carries a rate in the base, as before", () => {
    // ¥30 000 at 0.0062 is €186.00.
    const result = assembleBalances(
      converted,
      rowsOf([
        expense("dinner", "EUR", 6000n),
        expense("ryokan", "JPY", 30000n, { currency: "EUR", amount: 18600n }),
      ]),
      null,
    );

    expect(result.currencies.map((entry) => entry.currency)).toEqual(["EUR"]);
    expect(balanceOf(result, "EUR")).toEqual({
      [AIKO]: 12300n,
      [BEN]: -12300n,
    });
    expect(result.totalSpend.get("EUR")).toBe(24600n);
  });

  it("clears a foreign list with a repayment imported in the same currency", () => {
    const result = assembleBalances(
      converted,
      rowsOf(
        [expense("dinner", "EUR", 6000n), expense("ryokan", "JPY", 30000n)],
        [
          {
            id: "repaid",
            fromParticipantId: BEN,
            toParticipantId: AIKO,
            amount: 15000n,
            currency: "JPY",
            convertedAmount: null,
            convertedCurrency: null,
          },
        ],
      ),
      BEN,
    );

    expect(balanceOf(result, "JPY")).toEqual({ [AIKO]: 0n, [BEN]: 0n });
    // The yen repayment is not a euro repayment either.
    expect(balanceOf(result, "EUR")).toEqual({ [AIKO]: 3000n, [BEN]: -3000n });
    expect(result.suggestionsByCurrency.get("JPY")).toEqual([]);
    expect(result.settlementsFor.get("JPY")).toEqual({
      paid: 15000n,
      received: 0n,
    });
    expect(result.settlementsFor.has("EUR")).toBe(false);
    expect(result.contributions.get("JPY")).toEqual({
      paid: 0n,
      share: 15000n,
    });
  });

  it("books a repayment that carries a rate in the base", () => {
    const result = assembleBalances(
      converted,
      rowsOf(
        [expense("dinner", "EUR", 6000n)],
        [
          {
            id: "repaid",
            fromParticipantId: BEN,
            toParticipantId: AIKO,
            amount: 5000n,
            currency: "CHF",
            convertedAmount: 3000n,
            convertedCurrency: "EUR",
          },
        ],
      ),
      null,
    );

    expect(result.currencies.map((entry) => entry.currency)).toEqual(["EUR"]);
    expect(balanceOf(result, "EUR")).toEqual({ [AIKO]: 0n, [BEN]: 0n });
  });

  it("puts the base currency first, whatever the alphabet says", () => {
    const result = assembleBalances(
      converted,
      rowsOf([
        expense("fondue", "CHF", 8000n),
        expense("dinner", "EUR", 6000n),
      ]),
      null,
    );

    expect(result.currencies.map((entry) => entry.currency)).toEqual([
      "EUR",
      "CHF",
    ]);
  });

  it("leaves a separate group's currencies in code order", () => {
    const result = assembleBalances(
      separate,
      rowsOf([
        expense("dinner", "EUR", 6000n),
        expense("fondue", "CHF", 8000n),
      ]),
      null,
    );

    expect(result.currencies.map((entry) => entry.currency)).toEqual([
      "CHF",
      "EUR",
    ]);
  });

  /*
   * The property the fix rests on: a row the group holds no rate for cannot
   * move the base list. Whatever mix of base, converted and unconverted rows a
   * group holds, its euro balances are exactly those of the rows that can be
   * counted in euros, and every list still sums to zero.
   */
  it("never lets an unconverted foreign row move the base list", () => {
    const kind = fc.constantFrom("base", "converted", "unconverted");
    const row = fc.record({
      kind,
      amount: fc.bigInt({ min: 0n, max: 10n ** 7n }),
      foreign: fc.constantFrom("JPY", "USD", "CHF"),
    });

    fc.assert(
      fc.property(fc.array(row, { maxLength: 12 }), (rows) => {
        const entries = rows.map((one, index) => {
          const id = `e${index}`;
          if (one.kind === "base") return expense(id, "EUR", one.amount);
          if (one.kind === "converted") {
            return expense(id, one.foreign, one.amount, {
              currency: "EUR",
              amount: one.amount / 3n,
            });
          }
          return expense(id, one.foreign, one.amount);
        });

        const everything = assembleBalances(converted, rowsOf(entries), null);
        const countable = assembleBalances(
          converted,
          rowsOf(
            entries.filter((_, index) => rows[index].kind !== "unconverted"),
          ),
          null,
        );

        expect(balanceOf(everything, "EUR")).toEqual(
          balanceOf(countable, "EUR"),
        );
        for (const entry of everything.currencies) {
          expect(balancesSumToZero(entry.balances)).toBe(true);
        }
        if (everything.currencies.some((entry) => entry.currency === "EUR")) {
          expect(everything.currencies[0].currency).toBe("EUR");
        }
      }),
      { numRuns: 200 },
    );
  });
});
