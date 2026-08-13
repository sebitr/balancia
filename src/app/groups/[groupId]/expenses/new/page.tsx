import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { EmptyState } from "@/components/ui/empty-state";
import { requireGroupAccess } from "@/lib/actions";
import { isSemanticCategorizationEnabled } from "@/lib/env";
import { listParticipants } from "@/modules/groups/service";
import { loadMappings } from "@/modules/categorization/service";
import { Users } from "lucide-react";

export default async function NewExpensePage({
  params,
}: PageProps<"/groups/[groupId]/expenses/new">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);
  // Handed to the form in one go, so classification stays instant while
  // typing instead of a round trip per keystroke.
  const [participants, categoryMappings] = await Promise.all([
    listParticipants(access.groupId),
    loadMappings(access),
  ]);
  const t = await getTranslations("expensePages");
  const tCommon = await getTranslations("common");

  if (participants.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t("noPeopleTitle")}
        description={t("noPeopleDescription")}
        action={
          <Button asChild>
            <Link href={`/groups/${groupId}/members`}>{t("managePeople")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/groups/${groupId}/expenses`}>
            <ArrowLeft aria-hidden="true" />
            {tCommon("back")}
          </Link>
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("newTitle")}
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
        defaultCurrency={access.group.baseCurrency ?? "EUR"}
        categoryMappings={categoryMappings}
        semanticCategorization={isSemanticCategorizationEnabled()}
      />
    </div>
  );
}
