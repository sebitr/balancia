import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { requireGroupAccess } from "@/lib/actions";
import { listExpenses } from "@/modules/expenses/service";
import { listSettlements } from "@/modules/settlements/service";

export default async function ExpensesPage({
  params,
}: PageProps<"/groups/[groupId]/expenses">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [expenses, settlements] = await Promise.all([
    listExpenses(access.groupId, { limit: 200 }),
    listSettlements(access.groupId, { limit: 200 }),
  ]);

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
      title: `${settlement.fromName} paid ${settlement.toName}`,
      subtitle: settlement.notes ?? "Repayment",
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
          Expenses
        </h1>
        <Button asChild size="sm">
          <Link href={`/groups/${groupId}/expenses/new`}>
            <Plus aria-hidden="true" />
            Add
          </Link>
        </Button>
      </div>

      {timeline.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nothing recorded yet"
          description="Add your first expense to start tracking who paid for what."
          action={
            <Button asChild>
              <Link href={`/groups/${groupId}/expenses/new`}>
                <Plus aria-hidden="true" />
                Add an expense
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
                  className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
  return (
    <>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{entry.title}</span>
          {entry.kind === "settlement" && (
            <Badge variant="outline" className="shrink-0">
              Payment
            </Badge>
          )}
          {entry.recurring && (
            <Badge variant="secondary" className="shrink-0">
              Recurring
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {entry.date} · {entry.subtitle}
          {entry.attachmentCount > 0 &&
            ` · ${entry.attachmentCount} receipt${entry.attachmentCount === 1 ? "" : "s"}`}
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
