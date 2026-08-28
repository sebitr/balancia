import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import {
  expensePayers,
  expenseShares,
  expenses,
  participants,
  settlements,
} from "@/lib/db/schema";
import { CurrencyConfigurationError } from "@/modules/currencies/conversion";
import type { GroupAccess } from "@/lib/security/authorization";
import {
  balancesSumToZero,
  computeBalances,
  contributionsOf,
  revenuesOf,
  simplifyDebts,
  totalSpendByCurrency,
  type BalanceInputExpense,
  type BalanceInputSettlement,
  type Contribution,
  type CurrencyBalances,
  type Revenue,
  type RepaymentSuggestion,
} from "./engine";

/**
 * Balance service: loads the facts, hands them to the pure engine.
 *
 * The only real work here is choosing which amount column to feed the engine.
 * In a converted group that is the frozen converted amount (falling back to the
 * original when the expense was already in the base currency); in a separate
 * group it is always the original. Deleted expenses and settlements are
 * excluded at the query level.
 */

export interface GroupBalances {
  readonly currencies: readonly CurrencyBalances[];
  readonly suggestionsByCurrency: ReadonlyMap<string, RepaymentSuggestion[]>;
  readonly totalSpend: ReadonlyMap<string, bigint>;
  readonly participantNames: ReadonlyMap<string, string>;
  /**
   * What one participant paid and what their share came to, per currency —
   * empty unless `contributionsFor` named someone. It is derived from the same
   * rows the balances are, so asking for it costs no extra query.
   */
  readonly contributions: ReadonlyMap<string, Contribution>;
  /**
   * The same for income: what came in through that participant and what of it
   * is theirs. Kept apart from `contributions` because the two words that fit
   * spending — paid, share — invert their meaning on money coming in.
   */
  readonly revenues: ReadonlyMap<string, Revenue>;
  /**
   * Repayments involving the requested participant, kept as positive
   * magnitudes. Paying moves their position up; receiving moves it down.
   */
  readonly settlementsFor: ReadonlyMap<
    string,
    { readonly paid: bigint; readonly received: bigint }
  >;
  /**
   * Spending facts retained for the overview's period picker. These are the
   * exact normalized rows already used by the balance engine, with the group
   * calendar date added; no second money query or conversion path is needed.
   */
  readonly spendingFacts: readonly (BalanceInputExpense & {
    readonly expenseDate: string;
  })[];
}

/** The currency facts assembling a group's balances depends on. */
type GroupCurrencyFacts = Pick<
  GroupAccess["group"],
  "id" | "currencyMode" | "baseCurrency"
>;

/** One group's rows, however they were fetched. */
interface BalanceRows {
  readonly participants: readonly { id: string; displayName: string }[];
  readonly expenses: readonly {
    id: string;
    // Taken from the column rather than restated, so the two cannot drift.
    direction: (typeof expenses.direction)["_"]["data"];
    expenseDate: string;
    currency: string;
    convertedCurrency: string | null;
  }[];
  readonly payers: readonly {
    expenseId: string;
    participantId: string;
    amount: bigint;
    convertedAmount: bigint | null;
  }[];
  readonly shares: readonly {
    expenseId: string;
    participantId: string;
    amount: bigint;
    convertedAmount: bigint | null;
  }[];
  readonly settlements: readonly {
    id: string;
    fromParticipantId: string;
    toParticipantId: string;
    amount: bigint;
    currency: string;
    convertedAmount: bigint | null;
    convertedCurrency: string | null;
  }[];
}

const EMPTY_ROWS: BalanceRows = {
  participants: [],
  expenses: [],
  payers: [],
  shares: [],
  settlements: [],
};

export async function loadGroupBalances(
  access: Pick<GroupAccess, "groupId" | "group">,
  options: { db?: Database; contributionsFor?: string | null } = {},
): Promise<GroupBalances> {
  const db = options.db ?? getDb();
  const { groupId, group } = access;

  const participantRows = await db
    .select({
      id: participants.id,
      displayName: participants.displayName,
    })
    .from(participants)
    .where(eq(participants.groupId, groupId))
    // Stable ordering: rounding remainders and repayment tie-breaks depend on it.
    .orderBy(asc(participants.createdAt), asc(participants.id));

  const expenseRows = await db
    .select({
      id: expenses.id,
      direction: expenses.direction,
      expenseDate: expenses.expenseDate,
      currency: expenses.currency,
      convertedCurrency: expenses.convertedCurrency,
    })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)));

  const [payerRows, shareRows, settlementRows] = await Promise.all([
    db
      .select({
        expenseId: expensePayers.expenseId,
        participantId: expensePayers.participantId,
        amount: expensePayers.amount,
        convertedAmount: expensePayers.convertedAmount,
      })
      .from(expensePayers)
      .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
      .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt))),
    db
      .select({
        expenseId: expenseShares.expenseId,
        participantId: expenseShares.participantId,
        amount: expenseShares.amount,
        convertedAmount: expenseShares.convertedAmount,
      })
      .from(expenseShares)
      .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
      .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt))),
    db
      .select({
        id: settlements.id,
        fromParticipantId: settlements.fromParticipantId,
        toParticipantId: settlements.toParticipantId,
        amount: settlements.amount,
        currency: settlements.currency,
        convertedAmount: settlements.convertedAmount,
        convertedCurrency: settlements.convertedCurrency,
      })
      .from(settlements)
      .where(
        and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)),
      ),
  ]);

  return assembleBalances(
    group,
    {
      participants: participantRows,
      expenses: expenseRows,
      payers: payerRows,
      shares: shareRows,
      settlements: settlementRows,
    },
    options.contributionsFor ?? null,
  );
}

/**
 * The same balances for many groups, in a fixed number of queries.
 *
 * The home screen shows every group somebody belongs to, and asking
 * `loadGroupBalances` once per group made it cost `1 + 5N` round trips — each
 * one reading that group's entire history, because a net position is a fact
 * about all of it. Twelve groups was sixty-one queries per render, and the
 * screen is dynamic, so it paid that on every visit.
 *
 * Here the same five reads are issued once for all the groups at a time, and
 * the rows are bucketed by group before the identical per-group assembly runs.
 * Six queries, whatever the group count.
 */
export async function loadBalancesForGroups(
  groups: readonly GroupCurrencyFacts[],
  options: { db?: Database } = {},
): Promise<Map<string, GroupBalances>> {
  const results = new Map<string, GroupBalances>();
  if (groups.length === 0) return results;

  const db = options.db ?? getDb();
  const groupIds = groups.map((group) => group.id);
  const liveExpense = and(
    inArray(expenses.groupId, groupIds),
    isNull(expenses.deletedAt),
  );

  const [participantRows, expenseRows, payerRows, shareRows, settlementRows] =
    await Promise.all([
      db
        .select({
          groupId: participants.groupId,
          id: participants.id,
          displayName: participants.displayName,
        })
        .from(participants)
        .where(inArray(participants.groupId, groupIds))
        // Same ordering as the single-group path, and for the same reason:
        // rounding remainders and repayment tie-breaks depend on it. Grouping
        // in memory below preserves it.
        .orderBy(asc(participants.createdAt), asc(participants.id)),
      db
        .select({
          groupId: expenses.groupId,
          id: expenses.id,
          direction: expenses.direction,
          expenseDate: expenses.expenseDate,
          currency: expenses.currency,
          convertedCurrency: expenses.convertedCurrency,
        })
        .from(expenses)
        .where(liveExpense),
      db
        .select({
          groupId: expenses.groupId,
          expenseId: expensePayers.expenseId,
          participantId: expensePayers.participantId,
          amount: expensePayers.amount,
          convertedAmount: expensePayers.convertedAmount,
        })
        .from(expensePayers)
        .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
        .where(liveExpense),
      db
        .select({
          groupId: expenses.groupId,
          expenseId: expenseShares.expenseId,
          participantId: expenseShares.participantId,
          amount: expenseShares.amount,
          convertedAmount: expenseShares.convertedAmount,
        })
        .from(expenseShares)
        .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
        .where(liveExpense),
      db
        .select({
          groupId: settlements.groupId,
          id: settlements.id,
          fromParticipantId: settlements.fromParticipantId,
          toParticipantId: settlements.toParticipantId,
          amount: settlements.amount,
          currency: settlements.currency,
          convertedAmount: settlements.convertedAmount,
          convertedCurrency: settlements.convertedCurrency,
        })
        .from(settlements)
        .where(
          and(
            inArray(settlements.groupId, groupIds),
            isNull(settlements.deletedAt),
          ),
        ),
    ]);

  const byGroup = new Map<
    string,
    {
      participants: BalanceRows["participants"][number][];
      expenses: BalanceRows["expenses"][number][];
      payers: BalanceRows["payers"][number][];
      shares: BalanceRows["shares"][number][];
      settlements: BalanceRows["settlements"][number][];
    }
  >();
  for (const id of groupIds) {
    byGroup.set(id, {
      participants: [],
      expenses: [],
      payers: [],
      shares: [],
      settlements: [],
    });
  }

  for (const { groupId, ...row } of participantRows) {
    byGroup.get(groupId)?.participants.push(row);
  }
  for (const { groupId, ...row } of expenseRows) {
    byGroup.get(groupId)?.expenses.push(row);
  }
  for (const { groupId, ...row } of payerRows) {
    byGroup.get(groupId)?.payers.push(row);
  }
  for (const { groupId, ...row } of shareRows) {
    byGroup.get(groupId)?.shares.push(row);
  }
  for (const { groupId, ...row } of settlementRows) {
    byGroup.get(groupId)?.settlements.push(row);
  }

  for (const group of groups) {
    results.set(
      group.id,
      assembleBalances(group, byGroup.get(group.id) ?? EMPTY_ROWS, null),
    );
  }
  return results;
}

/**
 * Turns one group's rows into its balances. Pure: no query, no clock.
 *
 * Shared by both loaders above so that batching the reads cannot change an
 * answer — only how many round trips it took to get the rows.
 */
function assembleBalances(
  group: GroupCurrencyFacts,
  rows: BalanceRows,
  contributionsFor: string | null,
): GroupBalances {
  const groupId = group.id;
  const converts = group.currencyMode === "converted";

  if (converts && !group.baseCurrency) {
    throw new CurrencyConfigurationError(
      "A converted-currency group must define a base currency",
    );
  }

  const participantRows = rows.participants;
  const expenseRows = rows.expenses;
  const payerRows = rows.payers;
  const shareRows = rows.shares;
  const settlementRows = rows.settlements;

  const participantIds = participantRows.map((row) => row.id);
  const participantNames = new Map(
    participantRows.map((row) => [row.id, row.displayName]),
  );

  const payersByExpense = new Map<
    string,
    { participantId: string; amount: bigint }[]
  >();
  const sharesByExpense = new Map<
    string,
    { participantId: string; amount: bigint }[]
  >();

  const pick = (original: bigint, converted: bigint | null): bigint =>
    converts ? (converted ?? original) : original;

  for (const row of payerRows) {
    const list = payersByExpense.get(row.expenseId) ?? [];
    list.push({
      participantId: row.participantId,
      amount: pick(row.amount, row.convertedAmount),
    });
    payersByExpense.set(row.expenseId, list);
  }
  for (const row of shareRows) {
    const list = sharesByExpense.get(row.expenseId) ?? [];
    list.push({
      participantId: row.participantId,
      amount: pick(row.amount, row.convertedAmount),
    });
    sharesByExpense.set(row.expenseId, list);
  }

  const engineExpenses: BalanceInputExpense[] = expenseRows.map((row) => ({
    id: row.id,
    direction: row.direction,
    currency: converts ? (group.baseCurrency as string) : row.currency,
    payers: payersByExpense.get(row.id) ?? [],
    shares: sharesByExpense.get(row.id) ?? [],
  }));
  const spendingFacts = expenseRows.map((row) => ({
    id: row.id,
    direction: row.direction,
    expenseDate: row.expenseDate,
    currency: converts ? (group.baseCurrency as string) : row.currency,
    payers: payersByExpense.get(row.id) ?? [],
    shares: sharesByExpense.get(row.id) ?? [],
  }));

  const engineSettlements: BalanceInputSettlement[] = settlementRows.map(
    (row) => ({
      id: row.id,
      currency: converts ? (group.baseCurrency as string) : row.currency,
      fromParticipantId: row.fromParticipantId,
      toParticipantId: row.toParticipantId,
      amount: pick(row.amount, row.convertedAmount),
    }),
  );

  const currencies = computeBalances({
    participantIds,
    expenses: engineExpenses,
    settlements: engineSettlements,
  });

  // The invariant that makes the rest of the product trustworthy. If it ever
  // fails the data is inconsistent, and showing a number would be worse than
  // failing.
  for (const entry of currencies) {
    if (!balancesSumToZero(entry.balances)) {
      throw new Error(
        `Balance invariant violated for group ${groupId} in ${entry.currency}: balances do not sum to zero`,
      );
    }
  }

  const suggestionsByCurrency = new Map<string, RepaymentSuggestion[]>();
  for (const entry of currencies) {
    suggestionsByCurrency.set(entry.currency, simplifyDebts(entry.balances));
  }

  const settlementsFor = new Map<string, { paid: bigint; received: bigint }>();
  if (contributionsFor) {
    for (const settlement of engineSettlements) {
      if (
        settlement.fromParticipantId !== contributionsFor &&
        settlement.toParticipantId !== contributionsFor
      ) {
        continue;
      }
      const running = settlementsFor.get(settlement.currency) ?? {
        paid: 0n,
        received: 0n,
      };
      settlementsFor.set(settlement.currency, {
        paid:
          running.paid +
          (settlement.fromParticipantId === contributionsFor
            ? settlement.amount
            : 0n),
        received:
          running.received +
          (settlement.toParticipantId === contributionsFor
            ? settlement.amount
            : 0n),
      });
    }
  }

  return {
    currencies,
    suggestionsByCurrency,
    totalSpend: totalSpendByCurrency(engineExpenses),
    participantNames,
    contributions: contributionsFor
      ? contributionsOf(engineExpenses, contributionsFor)
      : new Map(),
    revenues: contributionsFor
      ? revenuesOf(engineExpenses, contributionsFor)
      : new Map(),
    settlementsFor,
    spendingFacts,
  };
}
