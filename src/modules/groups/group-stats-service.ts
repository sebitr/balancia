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
import type { GroupAccess } from "@/lib/security/authorization";
import { CurrencyConfigurationError } from "@/modules/currencies/conversion";
import { loadGroupBalances } from "@/modules/balances/service";
import {
  computeGroupStats,
  type GroupStats,
  type GroupStatsEntryFact,
} from "./group-stats";
import type { StatsSettlementFact } from "./member-stats";

/**
 * The facts behind a group's statistics.
 *
 * One payload for the whole screen: three windows, every currency and the
 * all-time records come out of the same rows, so the range switcher costs no
 * round trip and cannot show two blocks read at different instants.
 *
 * Balances are not derived here. `loadGroupBalances` remains the only place a
 * position comes from, and the "Open" metric reads its column from there —
 * a screen that recomputed today's balance from history would be a second
 * answer to a question that already has one.
 *
 * The choice of amount column is the same one the member loader makes, and for
 * the same reason: it is what "the currency this group balances in" means. A
 * converted group reads the frozen converted figure, a separate one reads what
 * was actually typed.
 */
export async function loadGroupStats(
  access: Pick<GroupAccess, "groupId" | "group" | "participantId">,
  options: { db?: Database; now?: Date } = {},
): Promise<GroupStats> {
  const db = options.db ?? getDb();
  const { groupId, group } = access;
  const converts = group.currencyMode === "converted";

  if (converts && !group.baseCurrency) {
    throw new CurrencyConfigurationError(
      "A converted-currency group must define a base currency",
    );
  }

  const [
    entryRows,
    payerRows,
    shareRows,
    settlementRows,
    memberRows,
    balances,
  ] = await Promise.all([
    db
      .select({
        id: expenses.id,
        description: expenses.description,
        category: expenses.category,
        subcategory: expenses.subcategory,
        direction: expenses.direction,
        expenseDate: expenses.expenseDate,
        createdAt: expenses.createdAt,
        currency: expenses.currency,
      })
      .from(expenses)
      .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt))),
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
        settledOn: settlements.settledOn,
        createdAt: settlements.createdAt,
        currency: settlements.currency,
        amount: settlements.amount,
        convertedAmount: settlements.convertedAmount,
        fromParticipantId: settlements.fromParticipantId,
        toParticipantId: settlements.toParticipantId,
      })
      .from(settlements)
      .where(
        and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)),
      ),
    db
      .select({
        id: participants.id,
        displayName: participants.displayName,
        removedAt: participants.removedAt,
      })
      .from(participants)
      .where(eq(participants.groupId, groupId))
      .orderBy(asc(participants.createdAt), asc(participants.id)),
    loadGroupBalances(access, { db }),
  ]);

  const pick = (original: bigint, converted: bigint | null): bigint =>
    converts ? (converted ?? original) : original;
  const currencyOf = (original: string): string =>
    converts ? (group.baseCurrency as string) : original;

  const payersByEntry = new Map<
    string,
    { participantId: string; amount: bigint }[]
  >();
  for (const row of payerRows) {
    const list = payersByEntry.get(row.expenseId) ?? [];
    list.push({
      participantId: row.participantId,
      amount: pick(row.amount, row.convertedAmount),
    });
    payersByEntry.set(row.expenseId, list);
  }

  const sharesByEntry = new Map<
    string,
    { participantId: string; amount: bigint }[]
  >();
  for (const row of shareRows) {
    const list = sharesByEntry.get(row.expenseId) ?? [];
    list.push({
      participantId: row.participantId,
      amount: pick(row.amount, row.convertedAmount),
    });
    sharesByEntry.set(row.expenseId, list);
  }

  const facts: GroupStatsEntryFact[] = entryRows.map((row) => ({
    id: row.id,
    description: row.description,
    category: row.category,
    subcategory: row.subcategory,
    direction: row.direction,
    expenseDate: row.expenseDate,
    createdAt: row.createdAt,
    currency: currencyOf(row.currency),
    payers: payersByEntry.get(row.id) ?? [],
    shares: sharesByEntry.get(row.id) ?? [],
  }));

  const settlementFacts: StatsSettlementFact[] = settlementRows.map((row) => ({
    id: row.id,
    settledOn: row.settledOn,
    createdAt: row.createdAt,
    currency: currencyOf(row.currency),
    fromParticipantId: row.fromParticipantId,
    toParticipantId: row.toParticipantId,
    amount: pick(row.amount, row.convertedAmount),
  }));

  const openBalances = new Map<string, ReadonlyMap<string, bigint>>();
  for (const entry of balances.currencies) {
    openBalances.set(
      entry.currency,
      new Map(
        entry.balances.map((balance) => [
          balance.participantId,
          balance.amount,
        ]),
      ),
    );
  }

  return computeGroupStats({
    facts,
    settlements: settlementFacts,
    names: new Map(memberRows.map((row) => [row.id, row.displayName])),
    // Somebody who has left still spent what they spent, but "per person" is
    // about the people carrying the group now.
    memberIds: memberRows
      .filter((row) => row.removedAt === null)
      .map((row) => row.id),
    openBalances,
    selfParticipantId: access.participantId ?? null,
    timezone: group.timezone,
    now: options.now ?? new Date(),
  });
}
