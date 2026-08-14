import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
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
  simplifyDebts,
  totalSpendByCurrency,
  type BalanceInputExpense,
  type BalanceInputSettlement,
  type Contribution,
  type CurrencyBalances,
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
}

export async function loadGroupBalances(
  access: Pick<GroupAccess, "groupId" | "group">,
  options: { db?: Database; contributionsFor?: string | null } = {},
): Promise<GroupBalances> {
  const db = options.db ?? getDb();
  const { groupId, group } = access;
  const converts = group.currencyMode === "converted";

  if (converts && !group.baseCurrency) {
    throw new CurrencyConfigurationError(
      "A converted-currency group must define a base currency",
    );
  }

  const participantRows = await db
    .select({
      id: participants.id,
      displayName: participants.displayName,
    })
    .from(participants)
    .where(eq(participants.groupId, groupId))
    // Stable ordering: rounding remainders and repayment tie-breaks depend on it.
    .orderBy(asc(participants.createdAt), asc(participants.id));

  const participantIds = participantRows.map((row) => row.id);
  const participantNames = new Map(
    participantRows.map((row) => [row.id, row.displayName]),
  );

  const expenseRows = await db
    .select({
      id: expenses.id,
      direction: expenses.direction,
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

  return {
    currencies,
    suggestionsByCurrency,
    totalSpend: totalSpendByCurrency(engineExpenses),
    participantNames,
    contributions: options.contributionsFor
      ? contributionsOf(engineExpenses, options.contributionsFor)
      : new Map(),
  };
}
