import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getNumberLocale } from "@/i18n/preferences";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AddEntryDrawer } from "@/components/entries/add-entry-drawer";
import type { DebtPair } from "@/components/entries/settle-blocks";
import { requireGroupAccess } from "@/lib/actions";
import {
  isReceiptScanningEnabled,
  isSemanticCategorizationEnabled,
} from "@/lib/env";
import { listParticipants } from "@/modules/groups/service";
import {
  loadFrequentCategories,
  loadMappings,
} from "@/modules/categorization/service";
import { loadGroupBalances } from "@/modules/balances/service";
import { formatMoney, money } from "@/modules/currencies/money";
import { PUSH } from "@/components/motion/transitions";

/**
 * Everything the add-entry drawer needs, loaded once.
 *
 * Shared by the two routes that can show it: the intercepted one, which opens
 * over the group, and the plain one a link or a refresh lands on. The only
 * difference between them is where dismissing goes, so it is the only thing
 * this takes as an argument — two copies of a page that loads five things
 * would drift on the first change to any of them.
 */
export async function NewEntryScreen({
  groupId,
  dismissTo,
}: {
  groupId: string;
  dismissTo: "back" | "group";
}) {
  const access = await requireGroupAccess(groupId);

  const [participants, categoryMappings, frequentCategories, balances, locale] =
    await Promise.all([
      listParticipants(access.groupId),
      loadMappings(access),
      loadFrequentCategories(access),
      loadGroupBalances(access),
      // The amounts below are pre-formatted for the form, so they follow the
      // reader's notation rather than their language.
      getNumberLocale(),
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
      currency: suggestion.currency,
      amountFormatted: formatMoney(
        money(suggestion.amount, suggestion.currency),
        { locale },
      ),
    }))
    .sort((a, b) => Number(BigInt(b.amountMinor) - BigInt(a.amountMinor)));

  return (
    <AddEntryDrawer
      dismissTo={dismissTo}
      groupId={access.groupId}
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
      frequentCategories={frequentCategories}
      semanticCategorization={isSemanticCategorizationEnabled()}
      receiptScanning={isReceiptScanningEnabled()}
    />
  );
}
