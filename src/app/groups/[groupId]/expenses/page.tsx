import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireGroupAccess } from "@/lib/actions";
import { listSpreadEntries } from "@/modules/expenses/service";
import { listParticipants } from "@/modules/groups/service";
import {
  firstTransactionDate,
  loadTransactionPage,
} from "@/modules/expenses/transactions";
import { settlementTotals } from "@/modules/settlements/service";
import { moneyForGroup } from "@/modules/currencies/display";
import { isSpending } from "@/modules/expenses/direction";
import { todayIn } from "@/modules/recurring/schedule";
import { countRecurringExpenses } from "@/modules/recurring/service";
import {
  EXPENSE_CATEGORY_IDS,
  normalizeLegacyCategory,
  type ExpenseCategory,
} from "@/modules/categorization";
import {
  categoryTotals,
  isDivided,
  spreadBands,
} from "@/modules/expenses/spread";
import {
  RepeatingLink,
  Transactions,
  type BandView,
  type EntryKind,
} from "@/components/expenses/transactions";

/**
 * Everything the group has recorded, and where the money went.
 *
 * The screen is split down one line: this Server Component owns the facts —
 * what was spent, by whom, in what currency, and what each row means for the
 * person reading it — and the client island owns the filtering, which is the
 * only thing here that changes without the data changing.
 *
 * There is no summary beyond the page title. A headline total, a category
 * count and a tally of what had been repaid all used to sit here, and each was
 * a restatement of the rows directly underneath — bought at the price of the
 * rows themselves, which on a phone started a third of the way down the screen.
 *
 * ## The rows arrive a page at a time
 *
 * Only the first page is built here; the island asks for the rest as the
 * reader reaches the bottom. This screen used to fetch a flat 200 and stop,
 * which stayed invisible until a group outgrew it and then cut its own history
 * off without saying so — a group holding entries back to 2019 showed nothing
 * before 2022.
 *
 * The things that describe the *whole* group rather than the page — the
 * category spread, which kind chips exist, and whether amounts can be ranked —
 * are measured over all of it, from their own queries. A proportion or a chip
 * counted over the pages read so far would redraw itself under the reader as
 * they scrolled. Those queries return sums rather than rows: the database adds
 * the group's history up, and the page reads tens of totals instead of every
 * expense ever recorded.
 *
 * A filter is not applied here. The island asks the transactions endpoint for
 * the filtered pages, or filters the rows it holds when it holds them all.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expensesList");
  return { title: t("eyebrow") };
}

export default async function ExpensesPage({
  params,
}: PageProps<"/groups/[groupId]/expenses">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [page, spending, repaid, people, firstDate, rules] = await Promise.all([
    loadTransactionPage(access),
    listSpreadEntries(access.groupId),
    settlementTotals(access.groupId),
    listParticipants(access.groupId),
    firstTransactionDate(access.groupId),
    countRecurringExpenses(access.groupId),
  ]);

  const t = await getTranslations("expensesList");

  /*
   * The way to the recurring expenses, whenever the group has one — even with
   * nothing recorded yet, which is exactly the state of a group whose first
   * rent is set for next month. See `RepeatingLink`.
   */
  const repeating = rules.total > 0 ? { running: rules.running } : null;

  if (page.rows.length === 0) {
    return (
      <div className="space-y-4">
        <PageTitle label={t("eyebrow")} />
        {repeating && (
          <RepeatingLink groupId={groupId} running={repeating.running} />
        )}
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
   * A converted group resolves to one currency, which is the screen the design
   * draws — unless it holds foreign rows that arrived with no rate, which stay
   * in their own. A `separate` group — the default — can hold several, and
   * there is no honest way to rank categories across them: the comparison the
   * spine invites would need an exchange rate nobody chose. So the spine
   * appears only when there is one currency to measure in, and simply is not
   * there when there is not.
   *
   * It also needs something to divide. While the whole total sits in one
   * category — nobody has filed anything, or everybody filed it all under
   * Groceries — the spine is a single band reading "Groceries · 100%": a chart
   * of one fact, and a filter whose only setting is the list already on
   * screen. So it stays out until there are two categories to draw, and the
   * list takes the width back.
   */
  const display = {
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
  };
  const spreads = categoryTotals(spending, display);
  const single = spreads.length === 1 ? spreads[0] : null;
  const bands: BandView[] | null =
    single && isDivided(single)
      ? spreadBands(single, single.categories.length).map((band) => ({
          key: band.key,
          categories: [...band.categories],
          total: band.total.toString(),
          share: band.share,
          rank: band.rank,
        }))
      : null;

  /*
   * Which chips the group can offer, counted over everything it has recorded.
   * Income is an expense running backwards, so both come out of the same scan;
   * a repayment lives in another table and is asked for separately.
   */
  const kinds: EntryKind[] = [];
  if (spending.some((entry) => isSpending(entry.direction))) {
    kinds.push("expense");
  }
  if (spending.some((entry) => !isSpending(entry.direction))) {
    kinds.push("revenue");
  }
  if (repaid.length > 0) kinds.push("settlement");

  /*
   * Whether `Largest amount` ranks anything, asked of every row the group has
   * in the currency each is listed in. It used to be read off the rows in the
   * browser, which was only the whole group because opening the sheet used to
   * download it; now the browser holds a page, and a page in one currency says
   * nothing about the next.
   */
  const listedIn = new Set(
    [...spending, ...repaid].map(
      (entry) => moneyForGroup(entry, display).currency,
    ),
  );
  const byAmount = listedIn.size <= 1;

  /*
   * What the filter sheet's Category list opens on, and the counts beside it.
   *
   * Both are measured over everything the group has recorded, for the same
   * reason the kind chips are: a count that shrank as its own filter took
   * effect would be telling the reader about the list rather than about the
   * group. Legacy codes are resolved first, so a group that has not been
   * touched since `housing` became `home` finds its rent under Home.
   *
   * Only taxonomy codes are counted. Free text kept verbatim by an import is
   * not a category the sheet can offer, and the spine is where those are
   * reachable.
   */
  const counts: Record<string, number> = {};
  for (const entry of spending) {
    const category = normalizeLegacyCategory(entry.category);
    if (category !== null) {
      counts[category] = (counts[category] ?? 0) + entry.count;
    }
  }
  const used = EXPENSE_CATEGORY_IDS.filter(
    (category: ExpenseCategory) => counts[category] !== undefined,
  );

  /*
   * How many transactions the group holds — the "of 42" the desktop table's
   * footer reads while nothing narrows the list. Out of the two scans already
   * made for the spread and the chips, so it costs no query of its own.
   */
  const total =
    spending.reduce((sum, entry) => sum + entry.count, 0) +
    repaid.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <Transactions
      groupId={groupId}
      eyebrow={<PageTitle label={t("eyebrow")} />}
      bands={bands}
      kinds={kinds}
      rows={page.rows}
      cursor={page.cursor}
      members={people.map((person) => ({
        id: person.id,
        displayName: person.displayName,
      }))}
      used={used}
      counts={counts}
      byAmount={byAmount}
      firstDate={firstDate}
      // The group's own calendar day, not the server's: `This month` has to
      // mean the month the expense dates were written against.
      today={todayIn(access.group.timezone)}
      self={access.participantId}
      total={total}
      repeating={repeating}
    />
  );
}

/**
 * The screen's heading.
 *
 * Rendered here rather than inside the island so the words that name the
 * screen are in the server's HTML, and so the island cannot accidentally
 * become the only thing that says what this page is.
 */
function PageTitle({ label }: { label: string }) {
  return (
    <h1 className="font-heading text-2xl font-semibold tracking-tight">
      {label}
    </h1>
  );
}
