import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { requireGroupAccess } from "@/lib/actions";
import { isSemanticCategorizationEnabled } from "@/lib/env";
import { getExpense } from "@/modules/expenses/service";
import { listParticipants } from "@/modules/groups/service";
import { loadMappings } from "@/modules/categorization/service";
import { toMajorString, money } from "@/modules/currencies/money";
import { POP } from "@/components/motion/transitions";

export default async function EditExpensePage({
  params,
}: PageProps<"/groups/[groupId]/expenses/[expenseId]/edit">) {
  const { groupId, expenseId } = await params;
  const access = await requireGroupAccess(groupId);

  const [expense, participants, categoryMappings] = await Promise.all([
    getExpense(access.groupId, expenseId),
    listParticipants(access.groupId),
    loadMappings(access),
  ]);

  if (!expense) {
    notFound();
  }

  const t = await getTranslations("expensePages");
  const tCommon = await getTranslations("common");

  // The stored split input is what lets the form reopen with the original
  // method and values rather than a normalized "exact" split.
  const storedEntries =
    expense.splitInput?.entries ??
    expense.shares.map((share) => ({
      participantId: share.participantId,
      value: share.amount.toString(),
    }));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link
            href={`/groups/${groupId}/expenses/${expenseId}`}
            transitionTypes={POP}
          >
            <ArrowLeft aria-hidden="true" />
            {tCommon("back")}
          </Link>
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("editTitle")}
        </h1>
      </div>

      <ExpenseForm
        groupId={access.groupId}
        participants={participants.map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
        }))}
        currencyMode={access.group.currencyMode}
        baseCurrency={access.group.baseCurrency}
        defaultCurrency={expense.currency}
        categoryMappings={categoryMappings}
        semanticCategorization={isSemanticCategorizationEnabled()}
        initial={{
          id: expense.id,
          direction: expense.direction,
          description: expense.description,
          notes: expense.notes ?? "",
          category: expense.category ?? "",
          amount: toMajorString(money(expense.amount, expense.currency)),
          currency: expense.currency,
          exchangeRate: expense.exchangeRate ?? "",
          expenseDate: expense.expenseDate,
          splitMethod: expense.splitMethod,
          payers: expense.payers.map((payer) => ({
            participantId: payer.participantId,
            amount: payer.amount.toString(),
          })),
          splitEntries: storedEntries,
        }}
      />
    </div>
  );
}
