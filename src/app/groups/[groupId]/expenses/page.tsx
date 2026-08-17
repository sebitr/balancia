import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireGroupAccess } from "@/lib/actions";
import { listExpenses } from "@/modules/expenses/service";
import { listSettlements } from "@/modules/settlements/service";
import { isSpending, signOf } from "@/modules/expenses/direction";
import {
  allocationForGroup,
  moneyForGroup,
} from "@/modules/currencies/display";
import {
  categoryKeyOf,
  categoryTotals,
  isCategorised,
  spreadBands,
} from "@/modules/expenses/spread";
import {
  Transactions,
  type BandView,
  type RowView,
} from "@/components/expenses/transactions";

/**
 * Everything the group has recorded, and where the money went.
 *
 * The screen is split down one line: this Server Component owns the facts —
 * what was spent, by whom, in what currency, and what each row means for the
 * person reading it — and the client island owns the filtering, which is the
 * only thing here that changes without the data changing.
 *
 * There is no page title beyond the eyebrow, and nothing above the list that
 * summarises it. A headline total, a category count and a tally of what had
 * been repaid all used to sit here, and each was a restatement of the rows
 * directly underneath — bought at the price of the rows themselves, which on a
 * phone started a third of the way down the screen.
 */
export default async function ExpensesPage({
  params,
}: PageProps<"/groups/[groupId]/expenses">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [expenses, settlements] = await Promise.all([
    listExpenses(access.groupId, { limit: 200 }),
    listSettlements(access.groupId, { limit: 200 }),
  ]);

  const t = await getTranslations("expensesList");
  const self = access.participantId;
  const displayGroup = {
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
  function positionOf(expense: (typeof expenses)[number]): string | null {
    if (!self) return null;
    const paid = expense.payers
      .filter((payer) => payer.participantId === self)
      .reduce(
        (sum, payer) =>
          sum + allocationForGroup(payer, access.group.currencyMode),
        0n,
      );
    const owed = expense.shares
      .filter((share) => share.participantId === self)
      .reduce(
        (sum, share) =>
          sum + allocationForGroup(share, access.group.currencyMode),
        0n,
      );
    if (paid === 0n && owed === 0n) return null;
    return (signOf(expense.direction) * (paid - owed)).toString();
  }

  // Expenses and settlements share one chronological list — that is how people
  // remember a trip — but a settlement is a repayment, not spending, and says
  // so with its own badge, its own neutral rail and no category.
  const rows: RowView[] = [
    ...expenses.map((expense): RowView => {
      const display = moneyForGroup(expense, displayGroup);
      return {
        kind: "expense",
        id: expense.id,
        date: expense.expenseDate,
        createdAt: expense.createdAt.toISOString(),
        title: expense.description,
        amount: display.amount.toString(),
        currency: display.currency,
        category: categoryKeyOf(expense.category),
        position: positionOf(expense),
        // Income keeps its amount positive in the database; the badge is what
        // says which way it went.
        revenue: !isSpending(expense.direction),
        recurring: expense.recurringExpenseId !== null,
      };
    }),
    ...settlements.map((settlement): RowView => {
      const display = moneyForGroup(settlement, displayGroup);
      return {
        kind: "settlement",
        id: settlement.id,
        date: settlement.settledOn,
        createdAt: settlement.createdAt.toISOString(),
        title: t("settlementTitle", {
          from: settlement.fromName,
          to: settlement.toName,
        }),
        amount: display.amount.toString(),
        currency: display.currency,
        category: null,
        // A repayment clears a position rather than creating one, so it is
        // shown neutrally — and only to the two people it names. Which of
        // them paid is already the row's title.
        position:
          self &&
          (settlement.fromParticipantId === self ||
            settlement.toParticipantId === self)
            ? display.amount.toString()
            : null,
        revenue: false,
        recurring: false,
      };
    }),
  ].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Eyebrow label={t("eyebrow")} />
        <EmptyState
          icon={Receipt}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button asChild>
              {/* No direction, like the bar's own Add: this opens a drawer
                  over the list rather than going anywhere. */}
              <Link href={`/groups/${groupId}/expenses/new`}>
                <Plus aria-hidden="true" />
                {t("addExpense")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  /*
   * The spread, per currency and never across them.
   *
   * A converted group resolves to exactly one currency, which is the screen
   * the design draws. A `separate` group — the default — can hold several, and
   * there is no honest way to rank categories across them: the comparison the
   * spine invites would need an exchange rate nobody chose. So the spine
   * appears only when there is one currency to measure in, and simply is not
   * there when there is not.
   *
   * It also needs something to divide. Until somebody files an expense under a
   * category the whole total sits in one bucket, and the spine becomes a single
   * full-height band reading "Uncategorised · 100%" — a chart of one fact, and
   * a filter whose only setting is the list already on screen. So it stays out
   * until there is a division to draw, and the list takes the width back.
   */
  const spreads = categoryTotals(expenses, {
    ...displayGroup,
  });
  const single = spreads.length === 1 ? spreads[0] : null;
  const bands: BandView[] | null =
    single && isCategorised(single)
      ? spreadBands(single).map((band) => ({
          key: band.key,
          categories: [...band.categories],
          total: band.total.toString(),
          share: band.share,
          rank: band.rank,
        }))
      : null;

  return (
    <Transactions
      groupId={groupId}
      eyebrow={<Eyebrow label={t("eyebrow")} />}
      bands={bands}
      rows={rows}
    />
  );
}

/**
 * The screen's heading, which is also its eyebrow.
 *
 * Rendered here rather than inside the island so the words that name the
 * screen are in the server's HTML, and so the island cannot accidentally
 * become the only thing that says what this page is.
 */
function Eyebrow({ label }: { label: string }) {
  return (
    <h1 className="text-[0.6875rem] font-semibold tracking-[0.08em] text-primary uppercase">
      {label}
    </h1>
  );
}
