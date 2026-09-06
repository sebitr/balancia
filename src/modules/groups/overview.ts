import "server-only";
import { and, count, eq, isNull, max, min } from "drizzle-orm";
import { DateTime } from "luxon";
import { getDb, type Database } from "@/lib/db/client";
import { expenses, participants, settlements } from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";
import { isSpending } from "@/modules/expenses/direction";
import { loadGroupBalances } from "@/modules/balances/service";
import {
  contributionsOf,
  totalSpendByCurrency,
  type BalanceInputExpense,
  type Contribution,
  CurrencyBalances,
  type RepaymentSuggestion,
  type Revenue,
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
  /**
   * The explainable components behind the resulting balance, in three pairs.
   *
   * Sign convention the copy depends on: money the reader holds on the
   * group's behalf lowers their balance. So spending contributes
   * `paid - share`, income contributes `revenueCredited - revenueReceived`,
   * and repayments contribute `settlementsPaid - settlementsReceived`. Every
   * figure here is the positive magnitude that was recorded.
   */
  readonly breakdown: {
    /** Spending entries only. */
    readonly paid: bigint;
    /** Spending entries only. */
    readonly share: bigint;
    /** Income the reader collected on the group's behalf. */
    readonly revenueReceived: bigint;
    /** The part of the group's income credited to the reader. */
    readonly revenueCredited: bigint;
    readonly settlementsPaid: bigint;
    readonly settlementsReceived: bigint;
    /** Signed remainder. Zero unless a future entry kind escapes the three. */
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

/**
 * One currency, whole — everything the overview's collapsed row shows at a
 * glance and everything its body shows once opened.
 *
 * The screen groups by currency because the reader does: "am I owed, in which
 * currency, and what do I do about it" is one question asked once per
 * currency, not three questions asked across all of them. Grouping it here
 * rather than in the component keeps the flat `rows` and `suggestions` below
 * intact for the mobile API, which reads them as they are.
 */
export interface CurrencyOverview {
  readonly currency: string;
  /** All-time group spend. Income is excluded, as everywhere else. */
  readonly totalSpent: bigint;
  /** Spending entries behind that total — the count the settled line names. */
  readonly expenseCount: number;
  /** The reader's own signed balance. Zero when square, and for a guest. */
  readonly position: bigint;
  /** Everyone with a balance here, most negative first. Settled ones stay. */
  readonly members: readonly BalanceRow[];
  /** The transfers that clear this currency. Its payment count is the length. */
  readonly transfers: readonly SettlementSuggestion[];
}

export interface GroupOverview {
  readonly participantCount: number;
  readonly expenseCount: number;
  /** First and last expense dates, as plain `YYYY-MM-DD`. Null with no expenses. */
  readonly span: { readonly first: string; readonly last: string } | null;
  readonly positions: readonly CurrencyPosition[];
  readonly spendingPeriods: readonly SpendingPeriod[];
  /** Every currency with activity, each carrying its own balances. */
  readonly currencies: readonly CurrencyOverview[];
  /** Every member with a balance, already ordered. The screen caps the list. */
  readonly rows: readonly BalanceRow[];
  readonly suggestions: readonly SettlementSuggestion[];
  /** When the reader last opened this group. Null on a first visit. */
  readonly lastOpenedAt: Date | null;
}

/**
 * Whether this group gets the collapsed-per-currency overview.
 *
 * That screen exists to stop a group's balances growing by a screenful per
 * currency, and a group with one currency has no such problem — it would trade
 * a hero amount readable across the room for a single tile and a row that
 * opens onto what was already on screen. So the shape follows the money.
 *
 * Counted, deliberately, rather than read off `currencyMode`. A group kept in
 * separate currencies that has so far only spent in one is a one-currency
 * group today, whatever it is configured to become — and it goes back to the
 * collapsed screen by itself the moment a second currency arrives.
 */
export function isMultiCurrency(
  currencies: readonly CurrencyOverview[],
): boolean {
  return currencies.length > 1;
}

/**
 * Which currency's row the overview opens on.
 *
 * The one with something to do in it: a currency the reader is not square
 * in first, then one anybody still owes in, then any. The base currency used
 * to win outright, which on a trip kept in EUR with one stray USD debt
 * opened a row whose whole body said everyone was square in EUR, and left
 * the two people who owed dollars behind a tap. Base currency, then most
 * spent, now only settle a tie inside a tier — and decide alone when every
 * currency is level, where it makes no difference which row opens.
 *
 * The choice is this function and nothing else; the screen never derives it.
 */
export function mainCurrencyOf(
  currencies: readonly CurrencyOverview[],
  baseCurrency: string | null,
): string | null {
  if (currencies.length === 0) return null;
  const tiers = [
    currencies.filter((entry) => entry.position !== 0n),
    currencies.filter((entry) => entry.transfers.length > 0),
    currencies,
  ];
  const tier = tiers.find((candidates) => candidates.length > 0) ?? currencies;
  const base = tier.find((entry) => entry.currency === baseCurrency);
  if (base) return base.currency;
  let largest = tier[0];
  for (const entry of tier) {
    if (entry.totalSpent > largest.totalSpent) largest = entry;
  }
  return largest.currency;
}

/** The three pairs of magnitudes a position is explained by. */
export interface PositionParts {
  readonly contribution?: Contribution;
  readonly revenue?: Revenue;
  readonly settlement?: { readonly paid: bigint; readonly received: bigint };
}

/**
 * Splits one position into the ledger that produced it.
 *
 * No balance is derived here — `amount` arrives already computed, and this
 * only says which recorded magnitudes account for it. Each pair is signed the
 * same way: what the reader put in raises their balance, what they hold on the
 * group's behalf lowers it. So spending contributes `paid - share`, income
 * contributes `credited - received`, repayments contribute
 * `paid - received`, and `otherAdjustments` is whatever the three could not
 * explain — zero for every entry kind that exists today, and the reason a
 * fourth one could not silently go missing.
 */
export function positionBreakdownOf(
  amount: bigint,
  parts: PositionParts,
): CurrencyPosition["breakdown"] {
  const paid = parts.contribution?.paid ?? 0n;
  const share = parts.contribution?.share ?? 0n;
  const revenueReceived = parts.revenue?.received ?? 0n;
  const revenueCredited = parts.revenue?.credited ?? 0n;
  const settlementsPaid = parts.settlement?.paid ?? 0n;
  const settlementsReceived = parts.settlement?.received ?? 0n;
  const explained =
    paid -
    share +
    revenueCredited -
    revenueReceived +
    settlementsPaid -
    settlementsReceived;

  return {
    paid,
    share,
    revenueReceived,
    revenueCredited,
    settlementsPaid,
    settlementsReceived,
    otherAdjustments: amount - explained,
  };
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
  const currencies: CurrencyOverview[] = [];
  const rows: BalanceRow[] = [];
  const suggestions: SettlementSuggestion[] = [];

  // How many entries stand behind each currency's total. Counted off the same
  // facts the total is summed from, and through the same gate: a currency that
  // reports what the group spent may not count the rent it took in alongside
  // it, or the two figures would describe different sets of entries.
  const entryCounts = new Map<string, number>();
  for (const fact of balances.spendingFacts) {
    if (!isSpending(fact.direction)) continue;
    entryCounts.set(fact.currency, (entryCounts.get(fact.currency) ?? 0) + 1);
  }

  for (const entry of balances.currencies) {
    const contribution = balances.contributions.get(entry.currency);
    const revenue = balances.revenues.get(entry.currency);
    const settlement = balances.settlementsFor.get(entry.currency);

    const members = orderBalanceRows(entry, balances.participantNames, self);
    const transfers = (
      balances.suggestionsByCurrency.get(entry.currency) ?? []
    ).map((suggestion) => ({
      fromParticipantId: suggestion.fromParticipantId,
      fromName:
        balances.participantNames.get(suggestion.fromParticipantId) ?? "",
      toParticipantId: suggestion.toParticipantId,
      toName: balances.participantNames.get(suggestion.toParticipantId) ?? "",
      currency: suggestion.currency,
      amount: suggestion.amount,
      fromIsSelf: suggestion.fromParticipantId === self,
      toIsSelf: suggestion.toParticipantId === self,
    }));

    rows.push(...members);
    suggestions.push(...transfers);

    const mine = self
      ? entry.balances.find((balance) => balance.participantId === self)
      : undefined;
    const amount = mine?.amount ?? 0n;

    currencies.push({
      currency: entry.currency,
      totalSpent: balances.totalSpend.get(entry.currency) ?? 0n,
      expenseCount: entryCounts.get(entry.currency) ?? 0,
      position: amount,
      members,
      transfers,
    });

    if (!self) continue;
    positions.push({
      currency: entry.currency,
      amount,
      counterparties: counterpartiesOf(
        balances.suggestionsByCurrency.get(entry.currency) ?? [],
        self,
        balances.participantNames,
      ),
      breakdown: positionBreakdownOf(amount, {
        contribution,
        revenue,
        settlement,
      }),
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
    currencies,
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
