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
   * Who ends up owing whom, for the three sentences that name a remainder.
   *
   * Absent on the rest, because there is nothing left to owe or nothing yet
   * to say. Never a negative amount: the direction is carried by the names,
   * which is the whole point of stating it as a sentence rather than a signed
   * figure.
   */
  readonly remainder?: {
    readonly fromName: string;
    readonly toName: string;
    readonly amountMinor: bigint;
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
  } | null;
  /** What is being paid, in minor units. Zero while the field is empty. */
  readonly amountMinor: bigint;
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
  const { pair, amountMinor, hasMethod } = input;

  if (!pair) return { kind: "noPair" };
  if (!hasMethod) return { kind: "noMethod" };
  if (amountMinor <= 0n) return { kind: "zeroAmount" };

  /*
   * A custom pair owes nothing by definition, so every franc of this payment
   * becomes a debt the other way. Stated in the opposite direction from the
   * payment — `Cyril will owe Seb 50.00` when Seb pays Cyril — because that is
   * what the ledger will say, and it is the half people do not expect.
   */
  if (pair.isCustom) {
    return {
      kind: "custom",
      remainder: {
        fromName: pair.toName,
        toName: pair.fromName,
        amountMinor,
      },
    };
  }

  const outstanding = pair.owedMinor - amountMinor;

  if (outstanding > 0n) {
    return {
      kind: "under",
      remainder: {
        fromName: pair.fromName,
        toName: pair.toName,
        amountMinor: outstanding,
      },
    };
  }

  if (outstanding < 0n) {
    // Overpaid, so the debt reverses: the payer is now owed the surplus.
    return {
      kind: "over",
      remainder: {
        fromName: pair.toName,
        toName: pair.fromName,
        amountMinor: -outstanding,
      },
    };
  }

  return { kind: "exact" };
}
