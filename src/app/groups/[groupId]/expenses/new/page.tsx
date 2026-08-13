import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { EmptyState } from "@/components/ui/empty-state";
import { requireGroupAccess } from "@/lib/actions";
import { listParticipants } from "@/modules/groups/service";
import { Users } from "lucide-react";

export default async function NewExpensePage({
  params,
}: PageProps<"/groups/[groupId]/expenses/new">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);
  const participants = await listParticipants(access.groupId);

  if (participants.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Add someone first"
        description="An expense needs at least one person to split it between."
        action={
          <Button asChild>
            <Link href={`/groups/${groupId}/members`}>Manage people</Link>
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
            Back
          </Link>
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Add an expense
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
      />
    </div>
  );
}
