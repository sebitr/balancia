/**
 * What a settlement will actually do to the ledger.
 *
 * The line under the payment method used to read `{from} and {to} settle
 * {amount} by {method}.` whatever the numbers were. It is true of the ordinary
 * case — somebody pays exactly what they owe — and wrong of every other one:
 * paying 50 of a 128.40 debt announced that the two of you were settled, and
 * paying somebody you owed nothing announced a settlement of a debt that never
 * existed.
 *
 * So the sentence is computed from the same values as the entry, and it states
 * the *resulting* balance rather than the intention. Anyone who is about to
 * create a debt out of nothing, or leave one standing, is told so before they
 * save.
 *
 * Including when the two figures are not in the same money. A payment carries
 * the currency it was made in and a debt the currency it is held in, and they
 * are only comparable once one has been restated as the other — which is why
 * this takes the restated figure and a reason it might be missing, rather than
 * two bigints it would have to assume were alike. Assuming they were alike is
 * how paying EUR 128.40 against a CHF 128.40 debt reported the two of you
 * settled while CHF 7.70 was still owed.
 *
 * Pure and framework-free: it returns which sentence to say and what to put in
 * it, and the component looks the words up. Testing a message key is testing
 * the decision; testing a rendered string is testing the translator.
 */

/** Which sentence the drawer should show. */
export type SettleOutcomeKind =
  /** Nothing has been chosen yet — who is paying whom. */
  | "noPair"
  /** A pair, but no way the money changed hands. */
  | "noMethod"
  /** A pair and a method, but nothing to move. */
  | "zeroAmount"
  /**
   * The payment is in a currency the debt is not, and the rate that would
   * bring the two together has not been given yet.
   */
  | "awaitingRate"
  /**
   * The payment is in a currency the debt is not, and nothing converts them:
   * a group that keeps its currencies apart keeps their debts apart too, so
   * this payment lands in its own ledger and leaves the debt standing.
   */
  | "otherCurrency"
  /** No balance existed; this payment creates one the other way. */
  | "custom"
  /** Less than was owed: the rest stands. */
  | "under"
  /** More than was owed: the surplus reverses the debt. */
  | "over"
  /** Exactly what was owed. */
  | "exact";

export interface SettleOutcome {
  readonly kind: SettleOutcomeKind;
  /**
   * The pair as chosen, for the sentence that names no figure.
   *
   * `exact` is the one outcome with nothing left to owe, so it has no
   * `remainder` and still needs two names. Absent before a pair is picked.
   */
  readonly pairNames?: {
    readonly fromName: string;
    readonly toName: string;
  };
  /**
   * Who ends up owing whom, for the four sentences that name a remainder.
   *
   * Absent on the rest, because there is nothing left to owe or nothing yet
   * to say. Never a negative amount: the direction is carried by the names,
   * which is the whole point of stating it as a sentence rather than a signed
   * figure.
   *
   * It carries its own currency because the two figures in play are not
   * always in one: what is left of a debt is in the debt's currency, while a
   * debt this payment *creates* is in the currency it was paid in. Formatting
   * either with whatever the amount field happens to hold is how a franc gets
   * printed as a euro.
   */
  readonly remainder?: {
    readonly fromName: string;
    readonly toName: string;
    readonly amountMinor: bigint;
    readonly currency: string;
  };
}

export interface SettleOutcomeInput {
  /** Null until somebody has picked a pair. */
  readonly pair: {
    readonly fromName: string;
    readonly toName: string;
    /**
     * What `from` owes `to` before this payment, in minor units.
     *
     * Zero for a custom pair — a payment between two people with no balance
     * between them — which is why `isCustom` is carried separately. A real
     * pair that has been settled down to nothing is not the same thing as one
     * that never owed anything, and they get different sentences.
     */
    readonly owedMinor: bigint;
    readonly isCustom: boolean;
    /**
     * What the debt is denominated in — not necessarily what is being paid.
     *
     * A group that converts holds every debt in its base currency; one that
     * keeps its currencies apart holds a separate ledger per currency, and a
     * pair can stand in more than one of them.
     */
    readonly currency: string;
  } | null;
  /**
   * What is being paid, in minor units of `currency`. Zero while the field is
   * empty.
   */
  readonly amountMinor: bigint;
  /** What the payment is denominated in. */
  readonly currency: string;
  /**
   * The same payment restated in the pair's currency, which is the only unit
   * it can be compared against a debt in.
   *
   * Equal to `amountMinor` when the two currencies already agree. Null when
   * they differ and nothing converts them — either because the rate has not
   * been typed yet, which `awaitingRate` tells apart, or because the group
   * keeps its currencies in separate ledgers and this payment is simply not
   * in the one that holds the debt.
   */
  readonly amountAgainstDebtMinor: bigint | null;
  /**
   * Whether the missing conversion is only a rate somebody has yet to type.
   *
   * Read together with a null `amountAgainstDebtMinor`: the difference between
   * "this will count once you say what a euro is worth" and "this will never
   * count against that debt" is the difference between asking for one more
   * field and stating a fact.
   */
  readonly awaitingRate: boolean;
  /** Whether a payment method has been chosen. */
  readonly hasMethod: boolean;
}

/**
 * The sentence to show, in the order the questions get answered.
 *
 * Pair, then method, then amount: it names the first thing still missing
 * rather than the most recently touched, so the line reads as a checklist
 * being worked down instead of flickering between complaints.
 */
export function settleOutcome(input: SettleOutcomeInput): SettleOutcome {
  const {
    pair,
    amountMinor,
    currency,
    amountAgainstDebtMinor,
    awaitingRate,
    hasMethod,
  } = input;

  if (!pair) return { kind: "noPair" };

  const pairNames = { fromName: pair.fromName, toName: pair.toName };

  if (!hasMethod) return { kind: "noMethod", pairNames };
  if (amountMinor <= 0n) return { kind: "zeroAmount", pairNames };

  /*
   * Nothing below this line can be said without both figures in one unit, so
   * the rate is asked for here rather than assumed. It comes after the amount
   * on purpose: a rate for a figure nobody has typed yet is a question about
   * nothing.
   */
  if (amountAgainstDebtMinor === null && awaitingRate) {
    return { kind: "awaitingRate", pairNames };
  }

  /*
   * A custom pair owes nothing by definition, so every franc of this payment
   * becomes a debt the other way. Stated in the opposite direction from the
   * payment — `Cyril will owe Seb 50.00` when Seb pays Cyril — because that is
   * what the ledger will say, and it is the half people do not expect.
   *
   * With no conversion to be had the debt lands in the currency it was paid
   * in, which is exactly what a separate ledger per currency means, so the
   * sentence names that one.
   */
  if (pair.isCustom) {
    return {
      kind: "custom",
      pairNames,
      remainder: {
        fromName: pair.toName,
        toName: pair.fromName,
        amountMinor: amountAgainstDebtMinor ?? amountMinor,
        currency: amountAgainstDebtMinor === null ? currency : pair.currency,
      },
    };
  }

  /*
   * A real debt, and a payment that cannot reach it: the group keeps its
   * currencies in separate ledgers and this one is not the debt's. Saying so
   * is the whole point — the alternative, comparing the two figures because
   * they are both numbers, is what announced a settlement of a franc debt to
   * somebody who had paid in euros.
   */
  if (amountAgainstDebtMinor === null) {
    return {
      kind: "otherCurrency",
      pairNames,
      remainder: {
        fromName: pair.fromName,
        toName: pair.toName,
        amountMinor: pair.owedMinor,
        currency: pair.currency,
      },
    };
  }

  const outstanding = pair.owedMinor - amountAgainstDebtMinor;

  if (outstanding > 0n) {
    return {
      kind: "under",
      pairNames,
      remainder: {
        fromName: pair.fromName,
        toName: pair.toName,
        amountMinor: outstanding,
        currency: pair.currency,
      },
    };
  }

  if (outstanding < 0n) {
    // Overpaid, so the debt reverses: the payer is now owed the surplus.
    return {
      kind: "over",
      pairNames,
      remainder: {
        fromName: pair.toName,
        toName: pair.fromName,
        amountMinor: -outstanding,
        currency: pair.currency,
      },
    };
  }

  return { kind: "exact", pairNames };
}
