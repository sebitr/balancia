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
  ...overrides,
});

const outcome = (overrides: Partial<SettleOutcomeInput> = {}) =>
  settleOutcome({
    pair: pair(),
    amountMinor: 12840n,
    hasMethod: true,
    ...overrides,
  });

describe("what is still missing", () => {
  it("asks for the pair first", () => {
    expect(
      settleOutcome({ pair: null, amountMinor: 0n, hasMethod: false }).kind,
    ).toBe("noPair");
    // Still the pair, even with everything else answered.
    expect(
      settleOutcome({ pair: null, amountMinor: 5000n, hasMethod: true }).kind,
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
    // Hervé still owes Seb the rest — same direction as the debt.
    expect(result.remainder).toEqual({
      fromName: "Hervé",
      toName: "Seb",
      amountMinor: 7840n,
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
      hasMethod: true,
    });
    expect(result.kind).toBe("custom");
    // Seb pays Cyril, so Cyril ends up owing Seb.
    expect(result.remainder).toEqual({
      fromName: "Cyril",
      toName: "Seb",
      amountMinor: 5000n,
    });
  });

  it("is not the same as a real pair that happens to be settled", () => {
    // Both owe zero. One never owed anything; the other has just been paid
    // off, and paying it again is an overpayment rather than a new debt.
    const settled = pair({ owedMinor: 0n, isCustom: false });
    expect(
      settleOutcome({ pair: settled, amountMinor: 5000n, hasMethod: true })
        .kind,
    ).toBe("over");
  });
});
