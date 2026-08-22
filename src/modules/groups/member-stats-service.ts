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
import {
  computeMemberStats,
  type MemberStats,
  type StatsEntryFact,
  type StatsSettlementFact,
} from "./member-stats";

/**
 * The facts behind one member's statistics.
 *
 * Balances are not derived here — `loadGroupBalances` remains the only place a
 * position comes from, and the member screen reads its headline from there.
 * What this loads is the *history* that screen reports on: descriptions,
 * categories, calendar days and the instants rows were written, none of which
 * a balance needs and all of which a statistic does.
 *
 * The one thing it repeats is the choice of amount column, because that choice
 * is what "the currency this group balances in" means: a converted group reads
 * the frozen converted figure, a separate one reads what was actually typed.
 * Getting it wrong here would put a chart in a different currency from the
 * position above it.
 */
export async function loadMemberStats(
  access: Pick<GroupAccess, "groupId" | "group">,
  participantId: string,
  options: { db?: Database; now?: Date } = {},
): Promise<MemberStats> {
  const db = options.db ?? getDb();
  const { groupId, group } = access;
  const converts = group.currencyMode === "converted";

  if (converts && !group.baseCurrency) {
    throw new CurrencyConfigurationError(
      "A converted-currency group must define a base currency",
    );
  }

  const [entryRows, payerRows, shareRows, settlementRows, memberRows] =
    await Promise.all([
      db
        .select({
          id: expenses.id,
          description: expenses.description,
          category: expenses.category,
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
          convertedAmount: settlements.convertedAmount,
          amount: settlements.amount,
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

  const facts: StatsEntryFact[] = entryRows.map((row) => ({
    id: row.id,
    description: row.description,
    category: row.category,
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

  return computeMemberStats({
    facts,
    settlements: settlementFacts,
    participantId,
    names: new Map(memberRows.map((row) => [row.id, row.displayName])),
    // Somebody who has left still spent what they spent, but "an even split
    // would be" is about the people carrying the group now.
    memberCount: memberRows.filter((row) => row.removedAt === null).length,
    timezone: group.timezone,
    now: options.now ?? new Date(),
  });
}
