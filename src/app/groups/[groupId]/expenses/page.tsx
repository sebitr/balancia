import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireGroupAccess } from "@/lib/actions";
import { listSpreadEntries } from "@/modules/expenses/service";
import { loadTransactionPage } from "@/modules/expenses/transactions";
import { hasSettlements } from "@/modules/settlements/service";
import { isSpending } from "@/modules/expenses/direction";
import {
  categoryTotals,
  isCategorised,
  spreadBands,
} from "@/modules/expenses/spread";
import {
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
 * The two things that describe the *whole* group rather than the page — the
 * category spread, and which kind chips exist — are measured over all of it,
 * from their own queries. A proportion or a chip counted over the pages read
 * so far would redraw itself under the reader as they scrolled.
 */
export default async function ExpensesPage({
  params,
}: PageProps<"/groups/[groupId]/expenses">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [page, spending, settlementsExist] = await Promise.all([
    loadTransactionPage(access),
    listSpreadEntries(access.groupId),
    hasSettlements(access.groupId),
  ]);

  const t = await getTranslations("expensesList");

  if (page.rows.length === 0) {
    return (
      <div className="space-y-4">
        <PageTitle label={t("eyebrow")} />
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
  const spreads = categoryTotals(spending, {
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
  });
  const single = spreads.length === 1 ? spreads[0] : null;
  const bands: BandView[] | null =
    single && isCategorised(single)
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
  if (settlementsExist) kinds.push("settlement");

  return (
    <Transactions
      groupId={groupId}
      eyebrow={<PageTitle label={t("eyebrow")} />}
      bands={bands}
      kinds={kinds}
      rows={page.rows}
      cursor={page.cursor}
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
