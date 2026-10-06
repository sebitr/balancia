import "server-only";
import { getTranslations } from "next-intl/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  min,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb, type Database } from "@/lib/db/client";
import { expenses, settlements } from "@/lib/db/schema";
import {
  compareKeysDesc,
  encodeCursor,
  keysetAfter,
  keysetBefore,
  keysetBeforeAmount,
  type ListCursor,
} from "@/lib/db/keyset";
import type { GroupAccess } from "@/lib/security/authorization";
import { getDateFormatter } from "@/i18n/preferences";
import {
  allocationForGroup,
  moneyForGroup,
} from "@/modules/currencies/display";
import { todayIn } from "@/modules/recurring/schedule";
import { listSettlements } from "@/modules/settlements/service";
import {
  REPAYMENT_TITLE,
  repaymentSide,
  type RepaymentSide,
} from "@/modules/settlements/side";
import {
  NO_FILTER,
  searchNeedle,
  type ListFilter,
  type RowView,
  type SortChoice,
} from "@/components/expenses/list-filter";
import { isSpending, signOf } from "./direction";
import { listExpenses, type ListedExpense } from "./service";
import { categoryKeyOf } from "./spread";
import {
  displayMoneySql,
  narrowing,
  searchableDays,
  settlementTitleSql,
  type FilterScope,
  type Narrowing,
} from "./transaction-filter";

/**
 * One page of the transactions list.
 *
 * The screen and the endpoint that extends it must produce identical rows —
 * the reader is scrolling one list, not stitching two — so the whole
 * construction lives here and both call it. It is the only place that knows a
 * settlement and an expense become the same kind of row.
 *
 * ## Why two queries and a merge
 *
 * Expenses and settlements are separate tables and, on this screen, one
 * chronology. Postgres could union them, but the union would have to be
 * re-derived and re-sorted on every page, and neither table's index would
 * survive the trip. Instead each table is paged on its own key, below the same
 * cursor, and the two runs are merged here — a merge of two already-sorted
 * lists, which is a single pass.
 *
 * That means asking each table for a full page and keeping at most half of
 * what comes back. The rows dropped are not lost and are not guessed at: every
 * one of them sorts below the cursor this page ends on, so the next call asks
 * for them again. Over-fetching a page is the price of never having to hold a
 * per-table cursor pair, which is the version of this that gets subtly wrong.
 *
 * ## Filtered, and in the other two orders
 *
 * A filter narrows both queries before either is paged, so a page of a search
 * is a page of matches rather than a page of history with the matches picked
 * out of it — see `transaction-filter.ts`. The merge does not change: two
 * lists, each already in order and each already narrowed, are still merged in
 * one pass, and the cursor still continues whatever list it came from.
 *
 * Oldest first and largest first are the same merge in another order. Each
 * table is walked by that order's own key, the two runs are merged by the same
 * comparison, and the cursor carries the amount when the order leads with it.
 */

/**
 * Rows per page.
 *
 * Comfortably more than one phone screen, so the reader never watches the list
 * arrive, and small enough that the first paint of a decade-old group is not
 * waiting on a decade of rows.
 */
export const TRANSACTION_PAGE_SIZE = 40;

export interface TransactionPage {
  readonly rows: readonly RowView[];
  /** Feed back to read the next page; null when the list has ended. */
  readonly cursor: string | null;
}

interface Keyed {
  readonly key: ListCursor;
  readonly row: RowView;
}

/** What to read, beyond "the next page of everything, newest first". */
export interface TransactionQuery {
  readonly cursor?: ListCursor | null;
  readonly limit?: number;
  /** The list's filters and its order. Absent is everything, newest first. */
  readonly filter?: ListFilter;
  /**
   * A day written the way the reader sees it, which is what a search matches.
   * This request's own notation when absent; tests hand one in.
   */
  readonly dateText?: (date: string) => string;
  /** Today in the group's timezone, which `This month` counts from. */
  readonly today?: string;
  readonly db?: Database;
}

export async function loadTransactionPage(
  access: GroupAccess,
  options: TransactionQuery = {},
): Promise<TransactionPage> {
  const limit = options.limit ?? TRANSACTION_PAGE_SIZE;
  const sort = (options.filter ?? NO_FILTER).sort;
  const t = await getTranslations("expensesList");
  // The same sentences the rows below are titled with, so a search reads the
  // title the reader sees.
  const where = await narrowingFor(
    access,
    (side, names) => t(REPAYMENT_TITLE[side], names),
    options,
  );
  const group = access.group;

  // A cursor written for another order names no position in this one, and is
  // read like any other cursor this server did not write: from the top.
  const cursor = options.cursor ?? null;
  const before =
    sort === "largest" && cursor?.amount === undefined ? null : cursor;

  const [expenses, settlements] = await Promise.all([
    where.expenses === null
      ? []
      : listExpenses(access.groupId, {
          db: options.db,
          limit,
          ...expenseSeek(sort, before, group, where.expenses),
        }),
    where.settlements === null
      ? []
      : listSettlements(access.groupId, {
          db: options.db,
          limit,
          ...settlementSeek(sort, before, group, where.settlements),
        }),
  ]);

  const self = access.participantId;
  const display = {
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
  };

  /** The key a row is ordered and resumed by, in this list's order. */
  function keyOf(
    date: string,
    time: string,
    id: string,
    amount: bigint,
  ): ListCursor {
    return sort === "largest"
      ? { date, time, id, amount: (amount < 0n ? -amount : amount).toString() }
      : { date, time, id };
  }

  /*
   * Whether this was recorded in a currency the group does not keep its books
   * in — the stored currency, not the displayed one, since a converted group
   * displays everything in its base and the question would answer itself.
   *
   * A group with no base currency has nothing for an entry to differ from, so
   * nothing in it is foreign.
   */
  function isForeign(currency: string): boolean {
    const base = access.group.baseCurrency;
    return base !== null && currency !== base;
  }

  /**
   * What this expense left the reader holding, in the currency the group uses
   * for balances and list amounts.
   *
   * Paid minus owed, signed by direction — income is spending run backwards,
   * so the person who received the money is the one who now owes. Taken from
   * the stored allocations, never from an assumed even split: a 70/30 dinner
   * is not 50/50 just because it is easier to render.
   */
  function positionOf(expense: ListedExpense): string | null {
    if (!self) return null;
    const paid = expense.payers
      .filter((payer) => payer.participantId === self)
      .reduce(
        (sum, payer) => sum + allocationForGroup(payer, display.mode),
        0n,
      );
    const owed = expense.shares
      .filter((share) => share.participantId === self)
      .reduce(
        (sum, share) => sum + allocationForGroup(share, display.mode),
        0n,
      );
    if (paid === 0n && owed === 0n) return null;
    return (signOf(expense.direction) * (paid - owed)).toString();
  }

  // Expenses and settlements share one chronological list — that is how people
  // remember a trip — but a settlement is a repayment, not spending, and says
  // so with its own badge, its own neutral rail and no category.
  const keyed: Keyed[] = [
    ...expenses.map((expense): Keyed => {
      const money = moneyForGroup(expense, display);
      /*
       * Who paid, by name and then by id. `listExpenses` reads payers and
       * shares in no particular order, so two reads of one expense could name
       * its two payers either way round; the table prints them, and a row
       * that swapped "Amélie and Jonas" for "Jonas and Amélie" between pages
       * would be a row that changed for no reason. Names first, because that
       * is the order a reader can see.
       */
      const payers = [...expense.payers].sort(
        (a, b) =>
          a.displayName.localeCompare(b.displayName) ||
          compareIds(a.participantId, b.participantId),
      );
      return {
        key: keyOf(
          expense.expenseDate,
          expense.cursorKey,
          expense.id,
          money.amount,
        ),
        row: {
          kind: "expense",
          id: expense.id,
          date: expense.expenseDate,
          title: expense.description,
          amount: money.amount.toString(),
          currency: money.currency,
          // An expense's own notes stay on its detail screen; the description
          // is already the row, and repeating one under the other would say
          // the same thing twice as often as not.
          note: null,
          category: categoryKeyOf(expense.category),
          subcategory: expense.subcategory,
          position: positionOf(expense),
          // Income keeps its amount positive in the database; the badge is
          // what says which way it went.
          revenue: !isSpending(expense.direction),
          recurring: expense.recurringExpenseId !== null,
          payers: payers.map((payer) => payer.participantId),
          // Everybody the entry moved, once each: who paid and who shares.
          people: [
            ...new Set(
              [...expense.payers, ...expense.shares].map(
                (row) => row.participantId,
              ),
            ),
          ],
          foreign: isForeign(expense.currency),
          receipt: expense.attachmentCount > 0,
          receipts: expense.attachmentCount,
          payerNames: payers.map((payer) => payer.displayName),
          // Who carries a share, once each, and by which method — what the
          // desktop table's Split column says as "6 equally" or "4 of 6".
          // Sorted for the reason the payers are: two reads, one answer.
          split: {
            method: expense.splitMethod,
            sharers: [
              ...new Set(expense.shares.map((share) => share.participantId)),
            ].sort(compareIds),
          },
          method: null,
        },
      };
    }),
    ...settlements.map((settlement): Keyed => {
      const money = moneyForGroup(settlement, display);
      const side = repaymentSide(settlement, self);
      return {
        key: keyOf(
          settlement.settledOn,
          settlement.cursorKey,
          settlement.id,
          money.amount,
        ),
        row: {
          kind: "settlement",
          id: settlement.id,
          date: settlement.settledOn,
          // Named from the reader's side when they are on one: "Sam paid you
          // back", never their own name in a sentence about somebody else.
          title: t(REPAYMENT_TITLE[side], {
            from: settlement.fromName,
            to: settlement.toName,
          }),
          amount: money.amount.toString(),
          currency: money.currency,
          note: settlement.notes,
          category: null,
          subcategory: null,
          // A repayment clears a position rather than creating one, so it is
          // shown neutrally — and only to the two people it names. Signed by
          // which way the money went for the reader: in when they received
          // it, out when they paid it, which is the word the row prints.
          position:
            side === "received"
              ? money.amount.toString()
              : side === "paid"
                ? (-money.amount).toString()
                : null,
          revenue: false,
          recurring: false,
          // Exactly one payer, and it is the half of the title that did the
          // paying.
          payers: [settlement.fromParticipantId],
          people: [settlement.fromParticipantId, settlement.toParticipantId],
          foreign: isForeign(settlement.currency),
          // A repayment carries no attachments; there is no table for them.
          receipt: false,
          receipts: 0,
          payerNames: [settlement.fromName],
          split: null,
          // An empty string is nobody saying, as the settle screen reads it.
          method: settlement.paymentMethod || null,
        },
      };
    }),
  ].sort((a, b) => compareIn(sort, a.key, b.key));

  const taken = keyed.slice(0, limit);

  /*
   * Three ways there can be more. Two of them are the obvious one — a table
   * filled its page, so it has at least one row it did not send — and the
   * third is the merge's own leftovers, which happens when neither table
   * filled a page but together they overflowed one.
   */
  const more =
    keyed.length > taken.length ||
    expenses.length === limit ||
    settlements.length === limit;

  const last = taken.at(-1);
  return {
    rows: taken.map((entry) => entry.row),
    cursor: more && last ? encodeCursor(last.key) : null,
  };
}

/**
 * How many transactions a filter leaves standing, over the whole group.
 *
 * What the filter sheet's apply button promises — `Show 4 transactions` —
 * when the browser does not hold enough of the list to count it there. The
 * same conditions as a page, so the number and the list it opens cannot
 * disagree; only the paging and the order are left out, since neither changes
 * how many rows there are.
 */
export async function countTransactions(
  access: GroupAccess,
  options: Omit<TransactionQuery, "cursor" | "limit"> = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const t = await getTranslations("expensesList");
  const where = await narrowingFor(
    access,
    (side, names) => t(REPAYMENT_TITLE[side], names),
    options,
  );

  const [expenseCount, settlementCount] = await Promise.all([
    where.expenses === null
      ? 0
      : db
          .select({ total: count() })
          .from(expenses)
          .where(
            and(
              eq(expenses.groupId, access.groupId),
              isNull(expenses.deletedAt),
              where.expenses,
            ),
          )
          .then(([row]) => row?.total ?? 0),
    where.settlements === null
      ? 0
      : db
          .select({ total: count() })
          .from(settlements)
          .where(
            and(
              eq(settlements.groupId, access.groupId),
              isNull(settlements.deletedAt),
              where.settlements,
            ),
          )
          .then(([row]) => row?.total ?? 0),
  ]);
  return expenseCount + settlementCount;
}

/**
 * The filter's conditions on each table, with everything they are read
 * against gathered first — which, for a search, includes writing out every
 * day the group has an entry on.
 */
async function narrowingFor(
  access: GroupAccess,
  settlementTitle: (
    side: RepaymentSide,
    names: { from: string; to: string },
  ) => string,
  options: Omit<TransactionQuery, "cursor" | "limit">,
): Promise<Narrowing> {
  const filter = options.filter ?? NO_FILTER;
  const searching = searchNeedle(filter) !== "";
  const dateText = searching
    ? (options.dateText ?? (await getDateFormatter()).plain)
    : null;

  const scope: FilterScope = {
    group: access.group,
    participantId: access.participantId,
    today: options.today ?? todayIn(access.group.timezone),
    settlementTitle: settlementTitleSql(settlementTitle, access.participantId),
    days:
      dateText === null
        ? new Map()
        : await searchableDays(options.db ?? getDb(), access.groupId, dateText),
  };
  return narrowing(filter, scope);
}

/** A table's order and keyset condition for one of the list's three orders. */
function seek(
  sort: SortChoice,
  columns: {
    readonly date: AnyPgColumn;
    readonly time: AnyPgColumn;
    readonly id: AnyPgColumn;
    readonly amount: SQL;
  },
  cursor: ListCursor | null,
): { where: SQL | undefined; orderBy: SQL[] } {
  switch (sort) {
    case "oldest":
      return {
        where: cursor ? keysetAfter(columns, cursor) : undefined,
        orderBy: [asc(columns.date), asc(columns.time), asc(columns.id)],
      };
    case "largest": {
      // Magnitude, as the browser ranks it. Amounts are stored positive, so
      // this is the amount — but the rule is the one the sort states.
      const magnitude = sql`abs(${columns.amount})`;
      return {
        where:
          cursor?.amount === undefined
            ? undefined
            : keysetBeforeAmount(magnitude, columns, {
                ...cursor,
                amount: cursor.amount,
              }),
        orderBy: [
          desc(magnitude),
          desc(columns.date),
          desc(columns.time),
          desc(columns.id),
        ],
      };
    }
    case "newest":
      return {
        where: cursor ? keysetBefore(columns, cursor) : undefined,
        orderBy: [desc(columns.date), desc(columns.time), desc(columns.id)],
      };
  }
}

function expenseSeek(
  sort: SortChoice,
  cursor: ListCursor | null,
  group: GroupAccess["group"],
  filter: SQL,
): { where: SQL | undefined; orderBy: SQL[] } {
  const order = seek(
    sort,
    {
      date: expenses.expenseDate,
      time: expenses.createdAt,
      id: expenses.id,
      amount: displayMoneySql(expenses, group).amount,
    },
    cursor,
  );
  return { where: and(filter, order.where), orderBy: order.orderBy };
}

function settlementSeek(
  sort: SortChoice,
  cursor: ListCursor | null,
  group: GroupAccess["group"],
  filter: SQL,
): { where: SQL | undefined; orderBy: SQL[] } {
  const order = seek(
    sort,
    {
      date: settlements.settledOn,
      time: settlements.createdAt,
      id: settlements.id,
      amount: displayMoneySql(settlements, group).amount,
    },
    cursor,
  );
  return { where: and(filter, order.where), orderBy: order.orderBy };
}

/**
 * The merge's comparison, in the same order the two queries were read in —
 * which for oldest first is newest first backwards, and for largest first is
 * the magnitude and then newest first among equals, as `sortRows` ranks them.
 */
function compareIn(sort: SortChoice, a: ListCursor, b: ListCursor): number {
  if (sort === "oldest") return compareKeysDesc(b, a);
  if (sort === "largest") {
    const left = BigInt(a.amount ?? "0");
    const right = BigInt(b.amount ?? "0");
    if (left !== right) return left > right ? -1 : 1;
  }
  return compareKeysDesc(a, b);
}

/** Two ids in a fixed order that does not depend on anybody's locale. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The day the group's history starts, or null when it has none.
 *
 * The custom date range prefills from here to today, so its default is the
 * whole of what the group has recorded, and neither field will go earlier —
 * there is nothing before it to find. Asked of the data rather than fixed at
 * some safe constant, because a constant would either cut off a group that has
 * been running since 2015 or offer 1970 to one that started last week.
 *
 * Both tables are asked, because either can hold the oldest row: a group that
 * imported its repayments before its expenses starts at a settlement.
 */
export async function firstTransactionDate(
  groupId: string,
  options: { db?: Database } = {},
): Promise<string | null> {
  const db = options.db ?? getDb();
  const [[expense], [settlement]] = await Promise.all([
    db
      .select({ date: min(expenses.expenseDate) })
      .from(expenses)
      .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt))),
    db
      .select({ date: min(settlements.settledOn) })
      .from(settlements)
      .where(
        and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)),
      ),
  ]);

  const dates = [expense?.date, settlement?.date].filter(
    (date): date is string => typeof date === "string",
  );
  return dates.sort()[0] ?? null;
}
