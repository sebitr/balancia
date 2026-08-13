import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Paperclip, Pencil } from "lucide-react";
import { parsePlainDate, PLAIN_DATE_FORMAT } from "@/i18n/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Amount } from "@/components/money/amount";
import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { requireGroupAccess } from "@/lib/actions";
import { getExpense } from "@/modules/expenses/service";
import { listAttachmentsForExpense } from "@/modules/attachments/service";
import { isExpenseCategory } from "@/modules/categorization";

/** Split method → catalogue key, so the badge follows the reader's language. */
const SPLIT_LABEL_KEYS = {
  equal: "splitEqual",
  exact: "splitExact",
  percentage: "splitPercentage",
  shares: "splitShares",
} as const;

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

  const t = await getTranslations("expenseDetail");
  const tCommon = await getTranslations("common");
  const tCategories = await getTranslations("expenses.categories");
  const format = await getFormatter();

  // Canonical categories are translated; anything else came from an import
  // and is shown exactly as it was imported.
  const categoryLabel = !expense.category
    ? null
    : isExpenseCategory(expense.category)
      ? tCategories(expense.category)
      : expense.category;
  const splitLabelKey =
    SPLIT_LABEL_KEYS[expense.splitMethod as keyof typeof SPLIT_LABEL_KEYS];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/groups/${groupId}/expenses`}>
            <ArrowLeft aria-hidden="true" />
            {tCommon("back")}
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {expense.description}
            </h1>
            <p className="text-sm text-muted-foreground">
              {format.dateTime(
                parsePlainDate(expense.expenseDate),
                PLAIN_DATE_FORMAT,
              )}
              {categoryLabel && ` · ${categoryLabel}`}
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
            {splitLabelKey ? t(splitLabelKey) : expense.splitMethod}
          </Badge>
          {expense.recurringExpenseId && (
            <Badge variant="outline">{t("fromRecurring")}</Badge>
          )}
          {expense.convertedAmount !== null && (
            <Badge variant="outline">
              {t("convertedAt", { rate: expense.exchangeRate ?? "" })}
            </Badge>
          )}
        </div>
      </div>

      {expense.convertedAmount !== null && expense.convertedCurrency && (
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="text-muted-foreground">{t("recordedIn")}</p>
            <Amount
              minorUnits={expense.convertedAmount.toString()}
              currency={expense.convertedCurrency}
              className="font-medium"
            />
            <p className="text-xs text-muted-foreground">{t("rateFrozen")}</p>
          </CardContent>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("paidBy")}
        </h2>
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
          {t("splitBetween")}
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
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("notes")}
          </h2>
          <p className="rounded-lg border p-3 text-sm whitespace-pre-wrap">
            {expense.notes}
          </p>
        </section>
      )}

      {attachments.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Paperclip aria-hidden="true" className="size-4" />
            {t("receipts")}
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
                  {t("kilobytes", {
                    size: format.number(
                      Math.round(Number(attachment.byteSize) / 1024),
                    ),
                  })}
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
            {t("edit")}
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
