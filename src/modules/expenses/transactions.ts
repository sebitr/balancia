import "server-only";
import { getTranslations } from "next-intl/server";
import {
  compareKeysDesc,
  encodeCursor,
  type ListCursor,
} from "@/lib/db/keyset";
import type { GroupAccess } from "@/lib/security/authorization";
import {
  allocationForGroup,
  moneyForGroup,
} from "@/modules/currencies/display";
import { listSettlements } from "@/modules/settlements/service";
import type { RowView } from "@/components/expenses/transactions";
import { isSpending, signOf } from "./direction";
import { listExpenses, type ListedExpense } from "./service";
import { categoryKeyOf } from "./spread";

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

export async function loadTransactionPage(
  access: GroupAccess,
  options: { cursor?: ListCursor | null; limit?: number } = {},
): Promise<TransactionPage> {
  const limit = options.limit ?? TRANSACTION_PAGE_SIZE;
  const before = options.cursor ?? null;

  const [expenses, settlements] = await Promise.all([
    listExpenses(access.groupId, { limit, before }),
    listSettlements(access.groupId, { limit, before }),
  ]);

  const t = await getTranslations("expensesList");
  const self = access.participantId;
  const display = {
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
  };

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
      return {
        key: {
          date: expense.expenseDate,
          time: expense.cursorKey,
          id: expense.id,
        },
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
          position: positionOf(expense),
          // Income keeps its amount positive in the database; the badge is
          // what says which way it went.
          revenue: !isSpending(expense.direction),
          recurring: expense.recurringExpenseId !== null,
        },
      };
    }),
    ...settlements.map((settlement): Keyed => {
      const money = moneyForGroup(settlement, display);
      return {
        key: {
          date: settlement.settledOn,
          time: settlement.cursorKey,
          id: settlement.id,
        },
        row: {
          kind: "settlement",
          id: settlement.id,
          date: settlement.settledOn,
          title: t("settlementTitle", {
            from: settlement.fromName,
            to: settlement.toName,
          }),
          amount: money.amount.toString(),
          currency: money.currency,
          note: settlement.notes,
          category: null,
          // A repayment clears a position rather than creating one, so it is
          // shown neutrally — and only to the two people it names. Which of
          // them paid is already the row's title.
          position:
            self &&
            (settlement.fromParticipantId === self ||
              settlement.toParticipantId === self)
              ? money.amount.toString()
              : null,
          revenue: false,
          recurring: false,
        },
      };
    }),
  ].sort((a, b) => compareKeysDesc(a.key, b.key));

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
