import "server-only";
import { and, count, eq, isNull, max, min } from "drizzle-orm";
import { DateTime } from "luxon";
import { getDb, type Database } from "@/lib/db/client";
import { expenses, participants, settlements } from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";
import { loadGroupBalances } from "@/modules/balances/service";
import {
  contributionsOf,
  totalSpendByCurrency,
  type BalanceInputExpense,
  CurrencyBalances,
  type RepaymentSuggestion,
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
  /** The explainable components behind the resulting balance. */
  readonly breakdown: {
    readonly paid: bigint;
    readonly share: bigint;
    readonly settlementsPaid: bigint;
    readonly settlementsReceived: bigint;
    /** Income, reimbursements and any other signed remainder. */
    readonly otherAdjustments: bigint;
  };
}

/** The three figures the stat strip shows, for one currency. */
export interface CurrencyStats {
  readonly currency: string;
  readonly groupSpent: bigint;
  readonly youPaid: bigint;
  readonly yourShare: bigint;
}

export type SpendingPeriodKey =
  "thisMonth" | "lastMonth" | "sinceLastSettlement" | "allTime";

export interface SpendingPeriod {
  readonly key: SpendingPeriodKey;
  readonly stats: readonly CurrencyStats[];
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

/** One simplified transfer instruction, deliberately separate from balances. */
export interface SettlementSuggestion {
  readonly fromParticipantId: string;
  readonly fromName: string;
  readonly toParticipantId: string;
  readonly toName: string;
  readonly currency: string;
  readonly amount: bigint;
  readonly fromIsSelf: boolean;
  readonly toIsSelf: boolean;
}

export interface GroupOverview {
  readonly participantCount: number;
  readonly expenseCount: number;
  /** First and last expense dates, as plain `YYYY-MM-DD`. Null with no expenses. */
  readonly span: { readonly first: string; readonly last: string } | null;
  readonly positions: readonly CurrencyPosition[];
  readonly spendingPeriods: readonly SpendingPeriod[];
  /** Every member with a balance, already ordered. The screen caps the list. */
  readonly rows: readonly BalanceRow[];
  readonly suggestions: readonly SettlementSuggestion[];
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
 * Everyone's balances in comparison order: most negative first, then settled,
 * then positive. Keeping zero rows is important here — this is a group view,
 * not merely an outstanding-debt list, and a settled person still belongs in
 * the comparison.
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

  return rows.sort((a, b) =>
    a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0,
  );
}

interface DatedExpense extends BalanceInputExpense {
  readonly expenseDate: string;
}

/** Four quiet spending views, all derived from the already-normalized facts. */
export function spendingPeriodsOf(
  facts: readonly DatedExpense[],
  selfParticipantId: string | null,
  timezone: string,
  lastSettlement: string | null,
  now: Date,
): SpendingPeriod[] {
  const localNow = DateTime.fromJSDate(now, { zone: timezone });
  const thisMonth = localNow.startOf("month");
  const nextMonth = thisMonth.plus({ months: 1 });
  const lastMonth = thisMonth.minus({ months: 1 });

  const ranges: readonly {
    key: SpendingPeriodKey;
    from: string | null;
    to: string | null;
  }[] = [
    {
      key: "thisMonth",
      from: thisMonth.toISODate(),
      to: nextMonth.toISODate(),
    },
    {
      key: "lastMonth",
      from: lastMonth.toISODate(),
      to: thisMonth.toISODate(),
    },
    { key: "sinceLastSettlement", from: lastSettlement, to: null },
    { key: "allTime", from: null, to: null },
  ];

  const currencies = [...new Set(facts.map((fact) => fact.currency))].sort();

  return ranges.map(({ key, from, to }) => {
    const selected = facts.filter(
      (fact) =>
        (from === null || fact.expenseDate >= from) &&
        (to === null || fact.expenseDate < to),
    );
    const group = totalSpendByCurrency(selected);
    const mine = selfParticipantId
      ? contributionsOf(selected, selfParticipantId)
      : new Map();

    return {
      key,
      stats: currencies.map((currency) => ({
        currency,
        groupSpent: group.get(currency) ?? 0n,
        youPaid: mine.get(currency)?.paid ?? 0n,
        yourShare: mine.get(currency)?.share ?? 0n,
      })),
    };
  });
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
  options: { db?: Database; now?: Date } = {},
): Promise<GroupOverview> {
  const db = options.db ?? getDb();
  const self = access.participantId;

  const [balances, [shape], [me], [people], [latestSettlement]] =
    await Promise.all([
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
      db
        .select({ settledOn: max(settlements.settledOn) })
        .from(settlements)
        .where(
          and(
            eq(settlements.groupId, access.groupId),
            isNull(settlements.deletedAt),
          ),
        ),
    ]);

  const positions: CurrencyPosition[] = [];
  const rows: BalanceRow[] = [];
  const suggestions: SettlementSuggestion[] = [];

  for (const entry of balances.currencies) {
    const contribution = balances.contributions.get(entry.currency);
    const settlement = balances.settlementsFor.get(entry.currency);

    rows.push(...orderBalanceRows(entry, balances.participantNames, self));
    suggestions.push(
      ...(balances.suggestionsByCurrency.get(entry.currency) ?? []).map(
        (suggestion) => ({
          fromParticipantId: suggestion.fromParticipantId,
          fromName:
            balances.participantNames.get(suggestion.fromParticipantId) ?? "",
          toParticipantId: suggestion.toParticipantId,
          toName:
            balances.participantNames.get(suggestion.toParticipantId) ?? "",
          currency: suggestion.currency,
          amount: suggestion.amount,
          fromIsSelf: suggestion.fromParticipantId === self,
          toIsSelf: suggestion.toParticipantId === self,
        }),
      ),
    );

    if (!self) continue;
    const mine = entry.balances.find(
      (balance) => balance.participantId === self,
    );
    const amount = mine?.amount ?? 0n;
    const paid = contribution?.paid ?? 0n;
    const share = contribution?.share ?? 0n;
    const settlementsPaid = settlement?.paid ?? 0n;
    const settlementsReceived = settlement?.received ?? 0n;
    const explained = paid - share + settlementsPaid - settlementsReceived;
    positions.push({
      currency: entry.currency,
      amount,
      counterparties: counterpartiesOf(
        balances.suggestionsByCurrency.get(entry.currency) ?? [],
        self,
        balances.participantNames,
      ),
      breakdown: {
        paid,
        share,
        settlementsPaid,
        settlementsReceived,
        otherAdjustments: amount - explained,
      },
    });
  }

  const spendingPeriods = spendingPeriodsOf(
    balances.spendingFacts,
    self,
    access.group.timezone,
    latestSettlement?.settledOn ?? null,
    options.now ?? new Date(),
  );

  return {
    participantCount: people?.activeCount ?? 0,
    expenseCount: shape?.expenseCount ?? 0,
    span:
      shape?.first && shape.last
        ? { first: shape.first, last: shape.last }
        : null,
    positions,
    spendingPeriods,
    rows,
    suggestions,
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
