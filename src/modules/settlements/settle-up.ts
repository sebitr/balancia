import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { participants, settlements } from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";
import { loadGroupBalances } from "@/modules/balances/service";
import type { RepaymentSuggestion } from "@/modules/balances/engine";

/**
 * The settle-up screen's read model.
 *
 * The overview answers "where do I stand"; this screen answers the next
 * question, "what do I do about it" — the shortest set of transfers that
 * clears the group, each written as a sentence with the one action that fits
 * it.
 *
 * Nothing is recomputed here. `loadGroupBalances` remains the only place a
 * balance or a suggested transfer is derived, and what follows is grouping,
 * naming and ordering. The screen's own arithmetic is limited to counting.
 *
 * Currencies are kept apart all the way through. A transfer never crosses one,
 * so a group balancing in three currencies has three sets of instructions and
 * never a total.
 */

/** One suggested transfer, as the screen reads it. */
export interface SettleUpTransfer {
  readonly fromParticipantId: string;
  readonly fromName: string;
  readonly toParticipantId: string;
  readonly toName: string;
  readonly currency: string;
  /** Minor units, always positive — the direction is in the two ids. */
  readonly amount: bigint;
  readonly fromIsSelf: boolean;
  readonly toIsSelf: boolean;
}

/**
 * One currency's instructions, split into the two questions a reader has.
 *
 * `yours` is what they can act on; `others` is the rest of the plan, which
 * they are shown so the figures add up but which is not theirs to do. A
 * currency that is square carries neither, and the screen says so rather than
 * printing a zero.
 */
export interface SettleUpCurrency {
  readonly currency: string;
  readonly yours: readonly SettleUpTransfer[];
  readonly others: readonly SettleUpTransfer[];
}

/** A repayment that has already happened, for the all-settled screen. */
export interface SettledRepayment {
  readonly id: string;
  readonly fromName: string;
  readonly toName: string;
  readonly amount: bigint;
  readonly currency: string;
  /** The calendar day it was recorded for, `YYYY-MM-DD`. */
  readonly settledOn: string;
  /** Free text, as recorded — "TWINT", "Cash", a method nobody has heard of. */
  readonly paymentMethod: string | null;
}

export interface SettleUpView {
  /** Every currency the group balances in, settled ones included. */
  readonly currencies: readonly SettleUpCurrency[];
  /** Transfers across every currency — what the lead sentence counts. */
  readonly transferCount: number;
  /**
   * The most recent repayments, newest first.
   *
   * Only loaded when there is nothing left to settle: it is the one screen
   * with room for it, and on every other one it would be a second list
   * competing with the instructions.
   */
  readonly lastSettled: readonly SettledRepayment[];
}

/** How many past repayments the all-settled screen names. */
const LAST_SETTLED_ROWS = 3;

/**
 * Largest first, and stable where two are equal.
 *
 * The order the engine emits is deterministic but follows its own greedy walk
 * rather than anything a reader would recognise. Size is the order they read
 * in, and the original index breaks ties so two equal transfers cannot swap
 * places between renders.
 */
function bySize(
  a: { amount: bigint; index: number },
  b: { amount: bigint; index: number },
): number {
  if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
  return a.index - b.index;
}

/**
 * One currency's transfers, grouped and ordered for the screen.
 *
 * Pure, so the ordering rules are testable without a database.
 *
 * Within `yours`, what the reader owes comes before what they are owed: a debt
 * is the thing they can clear on their own, and being owed only ever leads to
 * asking someone else. `self` is null for a guest with no participant row of
 * their own, and then every transfer is somebody else's.
 */
export function groupTransfers(
  currency: string,
  suggestions: readonly RepaymentSuggestion[],
  names: ReadonlyMap<string, string>,
  self: string | null,
): SettleUpCurrency {
  const decorated = suggestions.map((suggestion, index) => ({
    index,
    amount: suggestion.amount,
    transfer: {
      fromParticipantId: suggestion.fromParticipantId,
      fromName: names.get(suggestion.fromParticipantId) ?? "",
      toParticipantId: suggestion.toParticipantId,
      toName: names.get(suggestion.toParticipantId) ?? "",
      currency: suggestion.currency,
      amount: suggestion.amount,
      fromIsSelf: suggestion.fromParticipantId === self,
      toIsSelf: suggestion.toParticipantId === self,
    } satisfies SettleUpTransfer,
  }));

  const outgoing = decorated.filter((entry) => entry.transfer.fromIsSelf);
  const incoming = decorated.filter((entry) => entry.transfer.toIsSelf);
  const others = decorated.filter(
    (entry) => !entry.transfer.fromIsSelf && !entry.transfer.toIsSelf,
  );

  return {
    currency,
    yours: [...outgoing.sort(bySize), ...incoming.sort(bySize)].map(
      (entry) => entry.transfer,
    ),
    others: others.sort(bySize).map((entry) => entry.transfer),
  };
}

/**
 * Everything the settle-up screen renders, in one call.
 *
 * The past-repayments query is conditional rather than parallel: it is only
 * ever shown when there is nothing left to settle, and a group in the middle
 * of a trip should not pay for a list nobody will see.
 */
export async function loadSettleUp(
  access: Pick<GroupAccess, "groupId" | "group" | "participantId">,
  options: { db?: Database } = {},
): Promise<SettleUpView> {
  const db = options.db ?? getDb();
  const balances = await loadGroupBalances(access, { db });

  const currencies = balances.currencies.map((entry) =>
    groupTransfers(
      entry.currency,
      balances.suggestionsByCurrency.get(entry.currency) ?? [],
      balances.participantNames,
      access.participantId,
    ),
  );

  const transferCount = currencies.reduce(
    (total, entry) => total + entry.yours.length + entry.others.length,
    0,
  );

  return {
    currencies,
    transferCount,
    lastSettled:
      transferCount === 0 ? await loadLastSettled(access.groupId, { db }) : [],
  };
}

/**
 * The repayments that cleared the group, newest first.
 *
 * Ordered by the day they were recorded for and then by when they were
 * written, which is the same ordering the transactions list uses — two
 * repayments entered on one evening for the same day still read in the order
 * they were made.
 */
async function loadLastSettled(
  groupId: string,
  options: { db?: Database } = {},
): Promise<SettledRepayment[]> {
  const db = options.db ?? getDb();

  const rows = await db
    .select({
      id: settlements.id,
      fromParticipantId: settlements.fromParticipantId,
      toParticipantId: settlements.toParticipantId,
      amount: settlements.amount,
      currency: settlements.currency,
      settledOn: settlements.settledOn,
      paymentMethod: settlements.paymentMethod,
    })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)))
    .orderBy(
      desc(settlements.settledOn),
      desc(settlements.createdAt),
      desc(settlements.id),
    )
    .limit(LAST_SETTLED_ROWS);

  if (rows.length === 0) return [];

  const names = await db
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(eq(participants.groupId, groupId));
  const nameById = new Map(names.map((row) => [row.id, row.displayName]));

  return rows.map((row) => ({
    id: row.id,
    fromName: nameById.get(row.fromParticipantId) ?? "",
    toName: nameById.get(row.toParticipantId) ?? "",
    amount: row.amount,
    currency: row.currency,
    settledOn: row.settledOn,
    paymentMethod: row.paymentMethod,
  }));
}
