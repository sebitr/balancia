import "server-only";
import { oncePerRender } from "@/lib/render-memo";
import { and, count, desc, eq, isNull, max, min } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { expenses, groups, participants } from "@/lib/db/schema";
import {
  isGroupIcon,
  isGroupIconColor,
  type GroupIcon,
  type GroupIconColor,
} from "./icons";

/**
 * What the group header says about a group on a desktop: its tile, which
 * currencies it keeps, how many people and entries it holds and the days they
 * span.
 *
 * Counts and dates, never balances: the header sits above every tab, and the
 * figures belong to the screens under it. Three small reads, run side by side
 * and streamed in after the header's name and tabs, which need none of them.
 */
export interface GroupHeaderFacts {
  readonly icon: GroupIcon | null;
  readonly iconColor: GroupIconColor | null;
  /**
   * The currencies the group's entries are written in, the most used first.
   * A group that converts everything keeps one, its own; an empty group shows
   * the one it was created with, if any.
   */
  readonly currencies: readonly string[];
  readonly participantCount: number;
  readonly expenseCount: number;
  /** The first and last entry dates, `YYYY-MM-DD`; null in an empty group. */
  readonly first: string | null;
  readonly last: string | null;
}

export const loadGroupHeaderFacts = oncePerRender(
  async (
    groupId: string,
    options: { db?: Database } = {},
  ): Promise<GroupHeaderFacts> => {
    const db = options.db ?? getDb();
    const liveExpense = and(
      eq(expenses.groupId, groupId),
      isNull(expenses.deletedAt),
    );

    const [[group], [people], [span], byCurrency] = await Promise.all([
      db
        .select({
          icon: groups.icon,
          iconColor: groups.iconColor,
          currencyMode: groups.currencyMode,
          baseCurrency: groups.baseCurrency,
        })
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1),
      db
        .select({ total: count(participants.id) })
        .from(participants)
        .where(
          and(
            eq(participants.groupId, groupId),
            isNull(participants.removedAt),
          ),
        ),
      db
        .select({
          total: count(expenses.id),
          first: min(expenses.expenseDate),
          last: max(expenses.expenseDate),
        })
        .from(expenses)
        .where(liveExpense),
      db
        .select({ currency: expenses.currency, uses: count(expenses.id) })
        .from(expenses)
        .where(liveExpense)
        .groupBy(expenses.currency)
        .orderBy(desc(count(expenses.id)), expenses.currency),
    ]);

    const base = group?.baseCurrency ?? null;
    const written = byCurrency.map((row) => row.currency);
    const currencies =
      group?.currencyMode === "converted" && base
        ? [base]
        : written.length > 0
          ? written
          : base
            ? [base]
            : [];

    const icon = group?.icon;
    const iconColor = group?.iconColor;

    return {
      icon: isGroupIcon(icon) ? icon : null,
      iconColor: isGroupIconColor(iconColor) ? iconColor : null,
      currencies,
      participantCount: people?.total ?? 0,
      expenseCount: span?.total ?? 0,
      first: span?.first ?? null,
      last: span?.last ?? null,
    };
  },
);
