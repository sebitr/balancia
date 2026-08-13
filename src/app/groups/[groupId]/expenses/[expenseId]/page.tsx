import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Paperclip, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Amount } from "@/components/money/amount";
import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { requireGroupAccess } from "@/lib/actions";
import { getExpense } from "@/modules/expenses/service";
import { listAttachmentsForExpense } from "@/modules/attachments/service";

const SPLIT_LABEL: Record<string, string> = {
  equal: "Split equally",
  exact: "Exact amounts",
  percentage: "Split by percentage",
  shares: "Split by shares",
};

export default async function ExpenseDetailPage({
  params,
}: PageProps<"/groups/[groupId]/expenses/[expenseId]">) {
  const { groupId, expenseId } = await params;
  const access = await requireGroupAccess(groupId);

  const expense = await getExpense(access.groupId, expenseId);
  if (!expense) {
    notFound();
  }

  const attachments = await listAttachmentsForExpense(
    access.groupId,
    expenseId,
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/groups/${groupId}/expenses`}>
            <ArrowLeft aria-hidden="true" />
            Back
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {expense.description}
            </h1>
            <p className="text-sm text-muted-foreground">
              {expense.expenseDate}
              {expense.category && ` · ${expense.category}`}
            </p>
          </div>
          <Amount
            minorUnits={expense.amount.toString()}
            currency={expense.currency}
            className="text-xl font-semibold"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {SPLIT_LABEL[expense.splitMethod] ?? expense.splitMethod}
          </Badge>
          {expense.recurringExpenseId && (
            <Badge variant="outline">From a recurring expense</Badge>
          )}
          {expense.convertedAmount !== null && (
            <Badge variant="outline">Converted at {expense.exchangeRate}</Badge>
          )}
        </div>
      </div>

      {expense.convertedAmount !== null && expense.convertedCurrency && (
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="text-muted-foreground">Recorded in group currency</p>
            <Amount
              minorUnits={expense.convertedAmount.toString()}
              currency={expense.convertedCurrency}
              className="font-medium"
            />
            <p className="text-xs text-muted-foreground">
              Rate frozen when this expense was saved. It is not recalculated.
            </p>
          </CardContent>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Paid by</h2>
        <ul className="divide-y rounded-lg border">
          {expense.payers.map((payer) => (
            <li
              key={payer.participantId}
              className="flex items-center justify-between gap-3 p-3 text-sm"
            >
              <span className="truncate">{payer.displayName}</span>
              <Amount
                minorUnits={payer.amount.toString()}
                currency={expense.currency}
                className="font-medium"
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Split between
        </h2>
        <ul className="divide-y rounded-lg border">
          {expense.shares.map((share) => (
            <li
              key={share.participantId}
              className="flex items-center justify-between gap-3 p-3 text-sm"
            >
              <span className="truncate">{share.displayName}</span>
              <Amount
                minorUnits={share.amount.toString()}
                currency={expense.currency}
              />
            </li>
          ))}
        </ul>
      </section>

      {expense.notes && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Notes</h2>
          <p className="rounded-lg border p-3 text-sm whitespace-pre-wrap">
            {expense.notes}
          </p>
        </section>
      )}

      {attachments.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Paperclip aria-hidden="true" className="size-4" />
            Receipts
          </h2>
          <ul className="divide-y rounded-lg border">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="p-3 text-sm">
                <a
                  href={`/api/groups/${groupId}/attachments/${attachment.id}`}
                  className="underline underline-offset-4 hover:text-primary"
                  download
                >
                  {attachment.fileName}
                </a>
                <span className="ml-2 text-xs text-muted-foreground">
                  {(Number(attachment.byteSize) / 1024).toFixed(0)} KB
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-3">
        <Button asChild variant="outline" className="flex-1">
          <Link href={`/groups/${groupId}/expenses/${expenseId}/edit`}>
            <Pencil aria-hidden="true" />
            Edit
          </Link>
        </Button>
        <DeleteExpenseButton
          groupId={groupId}
          expenseId={expenseId}
          description={expense.description}
        />
      </div>
    </div>
  );
}
