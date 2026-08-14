import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AddEntryForm } from "@/components/entries/add-entry-form";
import type { DebtPair } from "@/components/entries/settle-blocks";
import { requireGroupAccess } from "@/lib/actions";
import {
  isReceiptScanningEnabled,
  isSemanticCategorizationEnabled,
} from "@/lib/env";
import { listParticipants } from "@/modules/groups/service";
import { loadMappings } from "@/modules/categorization/service";
import { loadGroupBalances } from "@/modules/balances/service";
import { formatMoney, money } from "@/modules/currencies/money";
import { PUSH } from "@/components/motion/transitions";

/**
 * Add an entry: expense, income, or a repayment.
 *
 * Everything the adaptive form needs is loaded here in one pass, including the
 * outstanding debts the settle tab starts from. That list is the difference
 * between "record a payment" being two dropdowns and being one tap, so it is
 * worth fetching even for the ~90% of visits that are ordinary expenses.
 */
export default async function NewEntryPage({
  params,
}: PageProps<"/groups/[groupId]/expenses/new">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [participants, categoryMappings, balances, locale] = await Promise.all([
    listParticipants(access.groupId),
    loadMappings(access),
    loadGroupBalances(access),
    getLocale(),
  ]);

  const t = await getTranslations("expensePages");

  if (participants.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t("noPeopleTitle")}
        description={t("noPeopleDescription")}
        action={
          <Button asChild>
            <Link href={`/groups/${groupId}/members`} transitionTypes={PUSH}>
              {t("managePeople")}
            </Link>
          </Button>
        }
      />
    );
  }

  const names = new Map(
    participants.map((participant) => [
      participant.id,
      participant.displayName,
    ]),
  );

  /**
   * Who owes whom, largest first.
   *
   * These are the engine's *suggested* repayments rather than raw pairwise
   * balances: they are already simplified, so the list offers the payment that
   * actually clears something instead of a chain of three.
   *
   * A group holding several currencies contributes a row per currency; the
   * settle tab is pinned to one currency at a time, so they are flattened here
   * and the amount carries its own.
   */
  const outstanding: DebtPair[] = [...balances.suggestionsByCurrency.values()]
    .flat()
    .map((suggestion) => ({
      fromParticipantId: suggestion.fromParticipantId,
      fromName: names.get(suggestion.fromParticipantId) ?? "",
      toParticipantId: suggestion.toParticipantId,
      toName: names.get(suggestion.toParticipantId) ?? "",
      amountMinor: suggestion.amount.toString(),
      amountFormatted: formatMoney(
        money(suggestion.amount, suggestion.currency),
        { locale },
      ),
    }))
    .sort((a, b) => Number(BigInt(b.amountMinor) - BigInt(a.amountMinor)));

  return (
    <AddEntryForm
      groupId={access.groupId}
      groupName={access.group.name}
      members={participants.map((participant) => ({
        id: participant.id,
        displayName: participant.displayName,
      }))}
      selfId={access.participantId ?? participants[0].id}
      currencyMode={access.group.currencyMode}
      baseCurrency={access.group.baseCurrency}
      defaultCurrency={access.group.baseCurrency ?? "EUR"}
      timezone={access.group.timezone}
      outstanding={outstanding}
      categoryMappings={categoryMappings}
      semanticCategorization={isSemanticCategorizationEnabled()}
      receiptScanning={isReceiptScanningEnabled()}
    />
  );
}
