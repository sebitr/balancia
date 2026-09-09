import { describe, expect, it } from "vitest";
import { settleOutcome, type SettleOutcomeInput } from "./settle-outcome";

/**
 * The sentence somebody reads before recording a repayment.
 *
 * Every case here was previously one string — "Hervé and Seb settle 50.00 by
 * TWINT." — which was true of the exact payment and a lie about the other
 * four.
 */

const pair = (
  overrides: Partial<NonNullable<SettleOutcomeInput["pair"]>> = {},
) => ({
  fromName: "Hervé",
  toName: "Seb",
  owedMinor: 12840n,
  isCustom: false,
  currency: "CHF",
  ...overrides,
});

/**
 * The ordinary case: paid in the currency the debt is held in, so the payment
 * needs no restating and `amountAgainstDebtMinor` is the amount itself.
 */
const outcome = (overrides: Partial<SettleOutcomeInput> = {}) => {
  const amountMinor = overrides.amountMinor ?? 12840n;
  return settleOutcome({
    pair: pair(),
    currency: "CHF",
    amountAgainstDebtMinor: amountMinor,
    awaitingRate: false,
    hasMethod: true,
    ...overrides,
    amountMinor,
  });
};

describe("what is still missing", () => {
  it("asks for the pair first", () => {
    expect(
      settleOutcome({
        pair: null,
        amountMinor: 0n,
        currency: "CHF",
        amountAgainstDebtMinor: 0n,
        awaitingRate: false,
        hasMethod: false,
      }).kind,
    ).toBe("noPair");
    // Still the pair, even with everything else answered.
    expect(
      settleOutcome({
        pair: null,
        amountMinor: 5000n,
        currency: "CHF",
        amountAgainstDebtMinor: 5000n,
        awaitingRate: false,
        hasMethod: true,
      }).kind,
    ).toBe("noPair");
  });

  it("then the method, then the amount", () => {
    expect(outcome({ hasMethod: false }).kind).toBe("noMethod");
    expect(outcome({ amountMinor: 0n }).kind).toBe("zeroAmount");
    // The order holds: no method outranks no amount.
    expect(outcome({ hasMethod: false, amountMinor: 0n }).kind).toBe(
      "noMethod",
    );
  });

  it("names nothing to owe while a question is open", () => {
    expect(outcome({ hasMethod: false }).remainder).toBeUndefined();
    expect(outcome({ amountMinor: 0n }).remainder).toBeUndefined();
  });
});

describe("paying an existing debt", () => {
  it("settles it when the amount matches", () => {
    const result = outcome();
    expect(result.kind).toBe("exact");
    expect(result.remainder).toBeUndefined();
  });

  it("names what is left when the payment is short", () => {
    const result = outcome({ amountMinor: 5000n });
    expect(result.kind).toBe("under");
    // Hervé still owes Seb the rest — same direction as the debt, and in the
    // debt's own money rather than whatever was handed over.
    expect(result.remainder).toEqual({
      fromName: "Hervé",
      toName: "Seb",
      amountMinor: 7840n,
      currency: "CHF",
    });
  });

  it("reverses the debt when the payment is too big", () => {
    const result = outcome({ amountMinor: 20000n });
    expect(result.kind).toBe("over");
    // Seb now owes Hervé the surplus: the names swap, the figure stays
    // positive.
    expect(result.remainder).toEqual({
      fromName: "Seb",
      toName: "Hervé",
      amountMinor: 7160n,
      currency: "CHF",
    });
  });

  it("is exact to the cent, not to the franc", () => {
    expect(outcome({ amountMinor: 12839n }).kind).toBe("under");
    expect(outcome({ amountMinor: 12841n }).kind).toBe("over");
  });
});

describe("paying somebody who was owed nothing", () => {
  const custom = pair({
    fromName: "Seb",
    toName: "Cyril",
    owedMinor: 0n,
    isCustom: true,
  });

  it("says a debt is being created, in the other direction", () => {
    const result = settleOutcome({
      pair: custom,
      amountMinor: 5000n,
      currency: "CHF",
      amountAgainstDebtMinor: 5000n,
      awaitingRate: false,
      hasMethod: true,
    });
    expect(result.kind).toBe("custom");
    // Seb pays Cyril, so Cyril ends up owing Seb.
    expect(result.remainder).toEqual({
      fromName: "Cyril",
      toName: "Seb",
      amountMinor: 5000n,
      currency: "CHF",
    });
  });

  it("is not the same as a real pair that happens to be settled", () => {
    // Both owe zero. One never owed anything; the other has just been paid
    // off, and paying it again is an overpayment rather than a new debt.
    const settled = pair({ owedMinor: 0n, isCustom: false });
    expect(
      settleOutcome({
        pair: settled,
        amountMinor: 5000n,
        currency: "CHF",
        amountAgainstDebtMinor: 5000n,
        awaitingRate: false,
        hasMethod: true,
      }).kind,
    ).toBe("over");
  });
});

describe("paying in a currency the debt is not held in", () => {
  /**
   * The bug this whole branch exists for: CHF 128.40 owed, EUR 128.40 handed
   * over, and a sentence that compared the two numbers because they were both
   * numbers. It announced a settlement while CHF 7.70 was still standing.
   */
  it("does not settle a franc debt with euros of the same figure", () => {
    const result = outcome({
      currency: "EUR",
      amountMinor: 12840n,
      // 128.40 euros is 120.70 francs at 0.94, which does not clear 128.40.
      amountAgainstDebtMinor: 12070n,
    });
    expect(result.kind).toBe("under");
    expect(result.remainder).toEqual({
      fromName: "Hervé",
      toName: "Seb",
      amountMinor: 770n,
      currency: "CHF",
    });
  });

  it("asks for the rate rather than guessing at one", () => {
    const result = outcome({
      currency: "EUR",
      amountMinor: 12840n,
      amountAgainstDebtMinor: null,
      awaitingRate: true,
    });
    expect(result.kind).toBe("awaitingRate");
    // Nothing is claimed about the debt while the conversion is unknown.
    expect(result.remainder).toBeUndefined();
  });

  it("leaves the debt standing when the two ledgers never meet", () => {
    // A group holding its currencies apart: the euro ledger and the franc
    // ledger are different books, and no rate joins them.
    const result = outcome({
      currency: "EUR",
      amountMinor: 12840n,
      amountAgainstDebtMinor: null,
      awaitingRate: false,
    });
    expect(result.kind).toBe("otherCurrency");
    // The debt is quoted unchanged, in its own currency.
    expect(result.remainder).toEqual({
      fromName: "Hervé",
      toName: "Seb",
      amountMinor: 12840n,
      currency: "CHF",
    });
  });

  it("still asks the earlier questions first", () => {
    const missing = {
      currency: "EUR",
      amountAgainstDebtMinor: null,
      awaitingRate: true,
    } as const;
    expect(outcome({ ...missing, hasMethod: false }).kind).toBe("noMethod");
    expect(outcome({ ...missing, amountMinor: 0n }).kind).toBe("zeroAmount");
  });

  it("puts a debt it creates in the money it was paid in", () => {
    // No conversion to be had, so the payment lands in its own ledger — and
    // the sentence has to say euros, not the francs the pair was quoted in.
    const result = settleOutcome({
      pair: pair({
        fromName: "Seb",
        toName: "Cyril",
        owedMinor: 0n,
        isCustom: true,
      }),
      amountMinor: 5000n,
      currency: "EUR",
      amountAgainstDebtMinor: null,
      awaitingRate: false,
      hasMethod: true,
    });
    expect(result.kind).toBe("custom");
    expect(result.remainder).toEqual({
      fromName: "Cyril",
      toName: "Seb",
      amountMinor: 5000n,
      currency: "EUR",
    });
  });
});
