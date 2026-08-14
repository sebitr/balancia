import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Plus, Receipt, RefreshCw } from "lucide-react";
import { parsePlainDate, PLAIN_DATE_FORMAT } from "@/i18n/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { requireGroupAccess } from "@/lib/actions";
import { listExpenses } from "@/modules/expenses/service";
import { listSettlements } from "@/modules/settlements/service";
import { PUSH } from "@/components/motion/transitions";

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

  // Expenses and settlements share one chronological list — that is how people
  // remember a trip — but settlements are visually distinct because they are
  // repayments, not spending.
  const timeline = [
    ...expenses.map((expense) => ({
      kind: "expense" as const,
      id: expense.id,
      date: expense.expenseDate,
      createdAt: expense.createdAt,
      title: expense.description,
      subtitle: expense.payers.map((payer) => payer.displayName).join(", "),
      amount: expense.amount.toString(),
      currency: expense.currency,
      attachmentCount: expense.attachmentCount,
      recurring: expense.recurringExpenseId !== null,
    })),
    ...settlements.map((settlement) => ({
      kind: "settlement" as const,
      id: settlement.id,
      date: settlement.settledOn,
      createdAt: settlement.createdAt,
      title: t("settlementTitle", {
        from: settlement.fromName,
        to: settlement.toName,
      }),
      subtitle: settlement.notes ?? t("repayment"),
      amount: settlement.amount.toString(),
      currency: settlement.currency,
      attachmentCount: 0,
      recurring: false,
    })),
  ].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          {/* Rent and bills belong next to the expenses they generate, not
              buried in group settings. */}
          <Button asChild size="sm" variant="ghost">
            <Link href={`/groups/${groupId}/recurring`} transitionTypes={PUSH}>
              <RefreshCw aria-hidden="true" />
              {t("recurringLink")}
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link
              href={`/groups/${groupId}/expenses/new`}
              transitionTypes={PUSH}
            >
              <Plus aria-hidden="true" />
              {t("add")}
            </Link>
          </Button>
        </div>
      </div>

      {timeline.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button asChild>
              <Link
                href={`/groups/${groupId}/expenses/new`}
                transitionTypes={PUSH}
              >
                <Plus aria-hidden="true" />
                {t("addExpense")}
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {timeline.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`}>
              {entry.kind === "expense" ? (
                <Link
                  href={`/groups/${groupId}/expenses/${entry.id}`}
                  transitionTypes={PUSH}
                  // A finger never hovers, so the row answers the press
                  // itself — every other list in the app already does.
                  className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:bg-muted motion-reduce:transition-none"
                >
                  <ExpenseRowContent entry={entry} />
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 p-3">
                  <ExpenseRowContent entry={entry} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExpenseRowContent({
  entry,
}: {
  entry: {
    kind: "expense" | "settlement";
    date: string;
    title: string;
    subtitle: string;
    amount: string;
    currency: string;
    attachmentCount: number;
    recurring: boolean;
  };
}) {
  // A synchronous Server Component, so the hook forms resolve here just as
  // they would in the browser.
  const t = useTranslations("expensesList");
  const format = useFormatter();

  return (
    <>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{entry.title}</span>
          {entry.kind === "settlement" && (
            <Badge variant="outline" className="shrink-0">
              {t("paymentBadge")}
            </Badge>
          )}
          {entry.recurring && (
            <Badge variant="secondary" className="shrink-0">
              {t("recurringBadge")}
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {format.dateTime(parsePlainDate(entry.date), PLAIN_DATE_FORMAT)} ·{" "}
          {entry.subtitle}
          {entry.attachmentCount > 0 &&
            ` · ${t("receiptCount", { count: entry.attachmentCount })}`}
        </span>
      </span>
      <Amount
        minorUnits={entry.amount}
        currency={entry.currency}
        className="shrink-0 text-sm font-medium"
      />
    </>
  );
}
