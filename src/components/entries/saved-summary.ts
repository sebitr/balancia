import { repaymentSide, type RepaymentSide } from "@/modules/settlements/side";
import type { EntryType } from "./entry-logic";

/**
 * The line under "Expense added".
 *
 * It used to read `description · amount`, which repeats what the reader just
 * typed. The two facts that actually go wrong are *who paid* and *who it was
 * split between* — people quit apps over having to reopen every entry to check
 * that the payer was right and that nobody was in the split who wasn't there.
 * Both are cheapest to fix at the moment of saving, so both are named here.
 *
 * Factual, never congratulatory. No "Nice one!", no "All set!" — the entry
 * landing in the list is the good news, and a line that celebrates it is a
 * line the reader has to look past to find the facts.
 *
 * Returns which message to say and what to put in it, so the branches can be
 * tested without a renderer and the words stay in the catalogue.
 */

export type SavedSummaryKind =
  /** An expense or income: amount, payer, split. */
  | "shared"
  /** A repayment: who paid whom back, and how the money moved. */
  | "settled";

/** The sentence a saved repayment is confirmed with, keyed in `addEntry.saved`. */
export const SETTLED_SENTENCE = {
  paid: "settledYouPaid",
  received: "settledPaidYou",
  between: "settledBetween",
} as const satisfies Record<RepaymentSide, string>;

export interface SavedSummary {
  readonly kind: SavedSummaryKind;
  /** Always shown, and always first: the figure. */
  readonly amount: string;
  /**
   * Who put the money in, or who received it.
   *
   * Phrased by direction: an expense says somebody *paid*, an income says
   * somebody *received*. Same fact, and the wrong word makes it read as the
   * opposite one.
   */
  readonly payer?: { readonly name: string; readonly received: boolean };
  /** How many people it was split between, or credited to. */
  readonly split?: { readonly count: number; readonly credited: boolean };
  /**
   * A repayment's two names, which side of it the reader is on, and its
   * method, when one was named.
   *
   * The side is what turns "Sam → Robin" into "Sam paid you back" when Robin
   * is the one reading: the arrow said who and never which way round, and it
   * named the reader to themselves in the third person.
   */
  readonly settlement?: {
    readonly side: RepaymentSide;
    readonly fromName: string;
    readonly toName: string;
    readonly method: string;
  };
}

export function savedSummary(input: {
  type: EntryType;
  amount: string;
  payerName: string;
  /** How many people the entry covers. */
  participantCount: number;
  /** The reader, who is "you" in a repayment they are part of. */
  selfId: string;
  settlement?: {
    fromParticipantId: string;
    fromName: string;
    toParticipantId: string;
    toName: string;
    /** "" when nobody said how it was paid. */
    method: string;
  } | null;
}): SavedSummary {
  const { type, amount, payerName, participantCount, selfId, settlement } =
    input;

  if (type === "settle" && settlement) {
    return {
      kind: "settled",
      amount,
      settlement: {
        side: repaymentSide(settlement, selfId),
        fromName: settlement.fromName,
        toName: settlement.toName,
        method: settlement.method,
      },
    };
  }

  const received = type === "income";
  return {
    kind: "shared",
    amount,
    payer: { name: payerName, received },
    split: { count: participantCount, credited: received },
  };
}
