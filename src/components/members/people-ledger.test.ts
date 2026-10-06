import { describe, expect, it } from "vitest";
import type { BalanceInputExpense } from "@/modules/balances/engine";
import { peopleLedger } from "./people-ledger";

/**
 * The People table's Paid and Share, read off the rows the balances came
 * from: in one currency, the one the group spends in most often, and only
 * over spending.
 */

function entry(
  currency: string,
  payer: [string, bigint],
  shares: [string, bigint][],
  direction: "out" | "in" = "out",
): BalanceInputExpense {
  return {
    id: `${currency}-${payer[0]}-${shares.length}-${direction}`,
    currency,
    direction,
    payers: [{ participantId: payer[0], amount: payer[1] }],
    shares: shares.map(([participantId, amount]) => ({
      participantId,
      amount,
    })),
  };
}

describe("peopleLedger", () => {
  it("is null for a group that has spent nothing", () => {
    expect(peopleLedger([], ["seb", "ravi"], null)).toBeNull();
  });

  it("sums what each person paid and carried, in minor units", () => {
    const ledger = peopleLedger(
      [
        entry(
          "EUR",
          ["seb", 12000n],
          [
            ["seb", 6000n],
            ["ravi", 6000n],
          ],
        ),
        entry(
          "EUR",
          ["ravi", 3000n],
          [
            ["seb", 1500n],
            ["ravi", 1500n],
          ],
        ),
      ],
      ["seb", "ravi", "jonas"],
      null,
    );

    expect(ledger).toEqual({
      currency: "EUR",
      others: [],
      figures: {
        seb: { paid: "12000", share: "7500" },
        ravi: { paid: "3000", share: "7500" },
      },
    });
  });

  it("leads with the currency spent in most often, not the largest sum", () => {
    // One yen row is a larger number than three euro rows put together; it
    // is still not the currency this group lives in.
    const ledger = peopleLedger(
      [
        entry("EUR", ["seb", 1000n], [["seb", 1000n]]),
        entry("EUR", ["seb", 1000n], [["ravi", 1000n]]),
        entry("EUR", ["ravi", 1000n], [["seb", 1000n]]),
        entry("JPY", ["ravi", 900000n], [["ravi", 900000n]]),
      ],
      ["seb", "ravi"],
      null,
    );

    expect(ledger?.currency).toBe("EUR");
    expect(ledger?.others).toEqual(["JPY"]);
  });

  it("lets a converted group's base currency lead whenever it is spent in", () => {
    const ledger = peopleLedger(
      [
        entry("CHF", ["seb", 1000n], [["seb", 1000n]]),
        entry("EUR", ["seb", 1000n], [["seb", 1000n]]),
        entry("EUR", ["seb", 1000n], [["seb", 1000n]]),
      ],
      ["seb"],
      "CHF",
    );

    expect(ledger?.currency).toBe("CHF");
    expect(ledger?.others).toEqual(["EUR"]);
  });

  it("leaves income out of both columns", () => {
    // Neither word survives money coming in: nobody "paid" a refund they
    // received, and their part of it is not a share of the spending.
    const ledger = peopleLedger(
      [
        entry(
          "EUR",
          ["seb", 2000n],
          [
            ["seb", 1000n],
            ["ravi", 1000n],
          ],
        ),
        entry(
          "EUR",
          ["ravi", 5000n],
          [
            ["seb", 2500n],
            ["ravi", 2500n],
          ],
          "in",
        ),
      ],
      ["seb", "ravi"],
      null,
    );

    expect(ledger?.figures).toEqual({
      seb: { paid: "2000", share: "1000" },
      ravi: { paid: "0", share: "1000" },
    });
  });
});
