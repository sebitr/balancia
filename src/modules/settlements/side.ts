/**
 * Which side of a repayment the reader is on.
 *
 * A repayment is named to whoever is reading it. "Sam paid Robin" said to
 * Robin made them find their own name in a sentence about somebody else, and
 * the arrow version of it — "Sam → Robin" — did not even say which way round
 * the arrow was meant. So every sentence that names a repayment comes in
 * three forms, and this is what picks one: the reader paid it, the reader was
 * paid it, or it was between two other people.
 *
 * Plain ids in, so the server, the list and the entry form all ask the same
 * question the same way.
 */
export type RepaymentSide = "paid" | "received" | "between";

export function repaymentSide(
  pair: {
    readonly fromParticipantId: string;
    readonly toParticipantId: string;
  },
  self: string | null | undefined,
): RepaymentSide {
  if (self && pair.fromParticipantId === self) return "paid";
  if (self && pair.toParticipantId === self) return "received";
  return "between";
}

/**
 * The title a repayment goes by in the transactions list, on its own screen,
 * in the search that finds it, and among the last repayments a settled group
 * shows on Settle up — one sentence per side, keyed in `expensesList`.
 */
export const REPAYMENT_TITLE = {
  paid: "settlementTitleYouPaid",
  received: "settlementTitlePaidYou",
  between: "settlementTitle",
} as const satisfies Record<RepaymentSide, string>;
