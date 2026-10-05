import { signOf, type EntryDirection } from "@/modules/expenses/direction";

/**
 * What one entry did to the people in it, worked out from its payers and
 * shares alone.
 *
 * The detail screen used to answer this only in a column of signed figures,
 * and to head it with the total in the "you owe" red for every reader —
 * including the one who had paid for everybody and was owed most of it. The
 * total is a fact about the entry and carries no direction; what carries one
 * is each person's part in it, and that is what is worked out here.
 *
 * Pure, so the arithmetic is tested without a server render; the words for it
 * live with the screen.
 */

/** Someone named on an entry, with what they put in or took out. */
export interface EntryParty {
  readonly participantId: string;
  readonly displayName: string;
  readonly amount: bigint;
}

/** As much of an entry as its stakes are read from. */
export interface EntryParties {
  readonly direction: EntryDirection;
  /** Who paid — or, on income, who received the money. */
  readonly payers: readonly EntryParty[];
  /** Who it was for — or, on income, who it is credited to. */
  readonly shares: readonly EntryParty[];
}

function sumFor(parties: readonly EntryParty[], participantId: string): bigint {
  return parties
    .filter((party) => party.participantId === participantId)
    .reduce((sum, party) => sum + party.amount, 0n);
}

/**
 * What this entry did to one person's balance — not what the group's balances
 * are now, which says nothing about the entry being read.
 *
 * Paid minus owed, signed by direction: income is spending run backwards, so
 * whoever received the money is the one who now owes the others. Positive is
 * money coming back to them, negative is money they owe, as everywhere else.
 */
export function impactOf(entry: EntryParties, participantId: string): bigint {
  return (
    signOf(entry.direction) *
    (sumFor(entry.payers, participantId) - sumFor(entry.shares, participantId))
  );
}

/**
 * The reader's own part in an entry, in the three shapes a sentence can take.
 *
 * - `paid`: they paid (or, on income, received) some of it. `paid` is how
 *   much, `net` what that left them with — and on a multi-payer entry that can
 *   go either way.
 * - `other`: somebody else paid, and the reader had a share. `payers` names
 *   who, in the order the entry lists them.
 * - `none`: nothing to say about them — they neither paid nor had a share, or
 *   they have no place in the group's money at all.
 */
export type Stake =
  | { readonly kind: "paid"; readonly paid: bigint; readonly net: bigint }
  | {
      readonly kind: "other";
      readonly payers: readonly string[];
      readonly net: bigint;
    }
  | { readonly kind: "none" };

export function stakeOf(
  entry: EntryParties,
  participantId: string | null,
): Stake {
  if (participantId === null) return { kind: "none" };

  const paid = sumFor(entry.payers, participantId);
  const net = impactOf(entry, participantId);
  if (paid > 0n) return { kind: "paid", paid, net };
  if (net === 0n) return { kind: "none" };

  return {
    kind: "other",
    // A payer down for nothing is a leftover of a multi-payer edit, not
    // somebody who paid.
    payers: entry.payers
      .filter((payer) => payer.amount > 0n)
      .map((payer) => payer.displayName),
    net,
  };
}
