import "server-only";
import { and, count, eq, isNull, max, min } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { expenses, participants } from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";
import { loadGroupBalances } from "@/modules/balances/service";
import type {
  CurrencyBalances,
  RepaymentSuggestion,
} from "@/modules/balances/engine";

/**
 * The group overview's read model.
 *
 * The screen asks three questions in order — where do I stand, what is this
 * group's shape, and who owes whom — and this module answers all three from a
 * single pass over the group's balances. No arithmetic is repeated here:
 * `loadGroupBalances` remains the only place a balance is derived, and what
 * follows is ordering, naming and counting.
 *
 * Every figure keeps its currency. A group that balances in two currencies has
 * two positions and two sets of totals, never one added together.
 */

/** Who the user's own position is with, once the debts are simplified. */
export interface PositionCounterparty {
  readonly participantId: string;
  readonly name: string;
  /** Magnitude, in minor units — the direction is the position's. */
  readonly amount: bigint;
}

/** The user's own standing in one currency. */
export interface CurrencyPosition {
  readonly currency: string;
  /** Signed minor units: positive means the user is owed. */
  readonly amount: bigint;
  /** Ordered by amount, descending. Empty when the user is square. */
  readonly counterparties: readonly PositionCounterparty[];
}

/** The three figures the stat strip shows, for one currency. */
export interface CurrencyStats {
  readonly currency: string;
  readonly groupSpent: bigint;
  readonly youPaid: bigint;
  readonly yourShare: bigint;
}

/** One line of "who owes whom". */
export interface BalanceRow {
  readonly participantId: string;
  readonly name: string;
  readonly currency: string;
  /** Signed minor units: positive means this person is owed. */
  readonly amount: bigint;
  readonly isSelf: boolean;
}

export interface GroupOverview {
  readonly participantCount: number;
  readonly expenseCount: number;
  /** First and last expense dates, as plain `YYYY-MM-DD`. Null with no expenses. */
  readonly span: { readonly first: string; readonly last: string } | null;
  readonly positions: readonly CurrencyPosition[];
  readonly stats: readonly CurrencyStats[];
  /** Every member with a balance, already ordered. The screen caps the list. */
  readonly rows: readonly BalanceRow[];
  /** When the reader last opened this group. Null on a first visit. */
  readonly lastOpenedAt: Date | null;
}

/**
 * Who the user would pay, or be paid by, to clear their position.
 *
 * Read off the simplified debts rather than off the raw balances: the question
 * on the screen is "who do I settle with", and simplification is what turns
 * everyone-owes-everyone into that shorter answer.
 */
export function counterpartiesOf(
  suggestions: readonly RepaymentSuggestion[],
  selfParticipantId: string,
  names: ReadonlyMap<string, string>,
): PositionCounterparty[] {
  return suggestions
    .flatMap((suggestion) => {
      if (suggestion.toParticipantId === selfParticipantId) {
        return [
          {
            participantId: suggestion.fromParticipantId,
            amount: suggestion.amount,
          },
        ];
      }
      if (suggestion.fromParticipantId === selfParticipantId) {
        return [
          {
            participantId: suggestion.toParticipantId,
            amount: suggestion.amount,
          },
        ];
      }
      return [];
    })
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .map((entry) => ({
      ...entry,
      name: names.get(entry.participantId) ?? "",
    }));
}

/**
 * "Who owes whom", in reading order: the reader first, then the people owed
 * money, then the people who owe it, each by descending magnitude.
 *
 * Settled members are dropped. A row saying someone is square adds nothing to
 * a list whose subject is open debts, and on a large group it would crowd out
 * the rows that matter.
 */
export function orderBalanceRows(
  entry: CurrencyBalances,
  names: ReadonlyMap<string, string>,
  selfParticipantId: string | null,
): BalanceRow[] {
  const rows = entry.balances.map((balance) => ({
    participantId: balance.participantId,
    name: names.get(balance.participantId) ?? "",
    currency: entry.currency,
    amount: balance.amount,
    isSelf: balance.participantId === selfParticipantId,
  }));

  const byMagnitude = (a: BalanceRow, b: BalanceRow) => {
    const left = a.amount < 0n ? -a.amount : a.amount;
    const right = b.amount < 0n ? -b.amount : b.amount;
    return right > left ? 1 : right < left ? -1 : 0;
  };

  const self = rows.filter((row) => row.isSelf && row.amount !== 0n);
  const creditors = rows
    .filter((row) => !row.isSelf && row.amount > 0n)
    .sort(byMagnitude);
  const debtors = rows
    .filter((row) => !row.isSelf && row.amount < 0n)
    .sort(byMagnitude);

  return [...self, ...creditors, ...debtors];
}

/**
 * Everything the overview screen renders, in one call.
 *
 * `participantId` is null for a guest with no participant row of their own;
 * the position card then has no position to show and the screen falls back to
 * the group's shape alone.
 */
export async function loadGroupOverview(
  access: Pick<GroupAccess, "groupId" | "group" | "participantId">,
  options: { db?: Database } = {},
): Promise<GroupOverview> {
  const db = options.db ?? getDb();
  const self = access.participantId;

  const [balances, [shape], [me], [people]] = await Promise.all([
    loadGroupBalances(access, { db, contributionsFor: self }),
    db
      .select({
        expenseCount: count(expenses.id),
        first: min(expenses.expenseDate),
        last: max(expenses.expenseDate),
      })
      .from(expenses)
      .where(
        and(eq(expenses.groupId, access.groupId), isNull(expenses.deletedAt)),
      ),
    self
      ? db
          .select({ lastOpenedAt: participants.lastOpenedAt })
          .from(participants)
          .where(eq(participants.id, self))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ activeCount: count(participants.id) })
      .from(participants)
      .where(
        and(
          eq(participants.groupId, access.groupId),
          isNull(participants.removedAt),
        ),
      ),
  ]);

  const positions: CurrencyPosition[] = [];
  const stats: CurrencyStats[] = [];
  const rows: BalanceRow[] = [];

  for (const entry of balances.currencies) {
    const contribution = balances.contributions.get(entry.currency);
    stats.push({
      currency: entry.currency,
      groupSpent: balances.totalSpend.get(entry.currency) ?? 0n,
      youPaid: contribution?.paid ?? 0n,
      yourShare: contribution?.share ?? 0n,
    });

    rows.push(...orderBalanceRows(entry, balances.participantNames, self));

    if (!self) continue;
    const mine = entry.balances.find(
      (balance) => balance.participantId === self,
    );
    positions.push({
      currency: entry.currency,
      amount: mine?.amount ?? 0n,
      counterparties: counterpartiesOf(
        balances.suggestionsByCurrency.get(entry.currency) ?? [],
        self,
        balances.participantNames,
      ),
    });
  }

  return {
    participantCount: people?.activeCount ?? 0,
    expenseCount: shape?.expenseCount ?? 0,
    span:
      shape?.first && shape.last
        ? { first: shape.first, last: shape.last }
        : null,
    positions,
    stats,
    rows,
    lastOpenedAt: me?.lastOpenedAt ?? null,
  };
}

/**
 * Stamps the visit, so the next one can say what changed.
 *
 * Called from `after()` once the response has gone out: the value this write
 * replaces is the one the page has just rendered against, and doing it during
 * the render would erase the boundary before the reader ever saw it.
 */
export async function markGroupOpened(
  participantId: string,
  options: { db?: Database; now?: Date } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(participants)
    .set({ lastOpenedAt: options.now ?? new Date() })
    .where(eq(participants.id, participantId));
}
