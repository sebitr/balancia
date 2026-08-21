import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getNumberLocale } from "@/i18n/preferences";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AddEntryDrawer } from "@/components/entries/add-entry-drawer";
import type { EditingEntry } from "@/components/entries/add-entry-form";
import type { DebtPair } from "@/components/entries/settle-blocks";
import { splitValuesToText } from "@/components/expenses/expense-form-logic";
import { requireGroupAccess } from "@/lib/actions";
import {
  configuredOcrProviderName,
  isLocalReceiptOcrEnabled,
  isReceiptScanningEnabled,
  isSemanticCategorizationEnabled,
} from "@/lib/env";
import { listParticipants } from "@/modules/groups/service";
import {
  loadFrequentCategories,
  loadMappings,
} from "@/modules/categorization/service";
import { loadGroupBalances } from "@/modules/balances/service";
import { formatMoney, money, toMajorString } from "@/modules/currencies/money";
import { getExpense } from "@/modules/expenses/service";
import { getSettlement } from "@/modules/settlements/service";
import { PUSH } from "@/components/motion/transitions";

/**
 * Everything the entry drawer needs, loaded once.
 *
 * Shared by the four routes that can show it: adding and editing, each in an
 * intercepted flavour that opens over the group and a plain one a link or a
 * refresh lands on. The only differences between them are where dismissing
 * goes and which entry — if any — is already there, so those are the only two
 * things this takes as arguments. Four copies of a page that loads five things
 * would drift on the first change to any of them.
 */
export async function EntryScreen({
  groupId,
  dismissTo,
  edit,
  whenGone = "notFound",
}: {
  groupId: string;
  dismissTo: "back" | "group";
  /** The entry to reopen, by the table it lives in. Absent means a new one. */
  edit?: { kind: "expense" | "settlement"; id: string };
  /**
   * What to answer when the entry to reopen is no longer there.
   *
   * `notFound` is right for the routes a cold link lands on. A removed entry
   * has no screen, and saying so is the honest answer.
   *
   * `nothing` is right for the intercepted ones, which are not a screen at all
   * but a slot held over the group. A slot keeps its active subpage across a
   * client-side navigation *even when the new URL does not match it*, so the
   * drawer's route goes on rendering after the reader has walked away from it
   * — and the one moment it is asked to render again is the refresh that
   * follows a conversion or a deletion, when the entry it names has just
   * stopped existing. Answering 404 there does not blank the drawer, which
   * nobody can see anyway: it takes the *group* down with it, which is how
   * turning an expense into a repayment ended on the not-found screen with
   * `/groups/<id>` in the address bar. Rendering nothing is what the slot
   * holds on every other group route — see its `default.tsx`.
   */
  whenGone?: "notFound" | "nothing";
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

  const editing = edit ? await loadEditing(access.groupId, edit) : undefined;
  // Null only ever comes back from a load that was asked for: an entry that is
  // not in this group, or has already been removed under the reader.
  if (editing === null) {
    if (whenGone === "nothing") return null;
    notFound();
  }

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
      defaultCurrency={editing?.currency ?? access.group.baseCurrency ?? "EUR"}
      timezone={access.group.timezone}
      outstanding={outstanding}
      categoryMappings={categoryMappings}
      frequentCategories={frequentCategories}
      semanticCategorization={isSemanticCategorizationEnabled()}
      receiptScanning={isReceiptScanningEnabled()}
      receiptOcrLocal={isLocalReceiptOcrEnabled()}
      // The provider's *name*, so the interface can say where a photograph
      // is going. Its key stays on the server and is never sent here.
      receiptOcrProvider={configuredOcrProviderName()}
      editing={editing}
    />
  );
}

async function loadEditing(
  groupId: string,
  edit: { kind: "expense" | "settlement"; id: string },
): Promise<EditingEntry | null> {
  return edit.kind === "settlement"
    ? loadSettlement(groupId, edit.id)
    : loadExpense(groupId, edit.id);
}

async function loadExpense(
  groupId: string,
  expenseId: string,
): Promise<EditingEntry | null> {
  const expense = await getExpense(groupId, expenseId);
  if (!expense) return null;

  // The stored split input is what lets the form reopen with the original
  // method and its values rather than a normalized "exact" split.
  const entries =
    expense.splitInput?.entries ??
    expense.shares.map((share) => ({
      participantId: share.participantId,
      value: share.amount.toString(),
    }));

  return {
    kind: "expense",
    id: expense.id,
    type: expense.direction === "in" ? "income" : "expense",
    amountText: toMajorString(money(expense.amount, expense.currency)),
    currency: expense.currency,
    exchangeRate: expense.exchangeRate ?? "",
    date: expense.expenseDate,
    description: expense.description,
    category: expense.category ?? "",
    notes: expense.notes ?? "",
    payerId: expense.payers[0]?.participantId ?? null,
    // An expense has no second side. Saying it was really a repayment means
    // naming who it was repaid to, and that is the one thing only a person
    // can answer.
    settleTo: null,
    includedIds: entries.map((entry) => entry.participantId),
    splitMethod: expense.splitMethod,
    // An equal split stores no values at all, which is the same empty object
    // the form starts a new equal split with. The rest come back as the text
    // their fields hold, which for an exact split is not how it was stored.
    splitValues: splitValuesToText(
      expense.splitMethod,
      entries,
      expense.currency,
    ),
    paymentMethod: "",
  };
}

async function loadSettlement(
  groupId: string,
  settlementId: string,
): Promise<EditingEntry | null> {
  const settlement = await getSettlement(groupId, settlementId);
  if (!settlement) return null;

  return {
    kind: "settlement",
    id: settlement.id,
    type: "settle",
    amountText: toMajorString(money(settlement.amount, settlement.currency)),
    currency: settlement.currency,
    exchangeRate: settlement.exchangeRate ?? "",
    date: settlement.settledOn,
    // A repayment has neither of these, and switching it to an expense is how
    // somebody says it should have. The form asks for a description then.
    description: "",
    category: "",
    notes: settlement.notes ?? "",
    payerId: settlement.fromParticipantId,
    settleTo: settlement.toParticipantId,
    includedIds: [],
    splitMethod: "equal",
    splitValues: {},
    paymentMethod: settlement.paymentMethod ?? "",
  };
}
