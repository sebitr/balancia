import { notFound } from "next/navigation";
import { z } from "zod";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getNumberLocale } from "@/i18n/preferences";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AddEntryDrawer } from "@/components/entries/add-entry-drawer";
import { SnapshotCapture } from "@/components/offline/snapshot-capture";
import type {
  EditingEntry,
  EditingRule,
} from "@/components/entries/add-entry-form";
import type { EntryType } from "@/components/entries/entry-logic";
import { getRecurringExpense } from "@/modules/recurring/service";
import type { DebtPair } from "@/components/entries/settle-blocks";
import type { RecentEntry } from "@/components/entries/duplicate-note";
import { groupSplitDefault } from "@/modules/groups/split-default";
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
import { defaultCurrency } from "@/modules/currencies/default-currency";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import {
  getExpense,
  listExpenses,
  type ExpenseSummary,
} from "@/modules/expenses/service";
import {
  getSettlement,
  mostUsedPaymentMethod,
} from "@/modules/settlements/service";
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
 *
 * Nothing here reads the URL's query, and nothing should: what a link tells
 * the drawer — a debt to open on, a draft to restore, a sheet to raise — is in
 * the fragment, which only the drawer can see. `drawer-fragment.ts` says why.
 */
export async function EntryScreen({
  groupId,
  dismissTo,
  edit,
  rule: ruleId,
  whenGone = "notFound",
}: {
  groupId: string;
  dismissTo: "back" | "group" | "recurring";
  /** The entry to reopen, by the table it lives in. Absent means a new one. */
  edit?: { kind: "expense" | "settlement"; id: string };
  /**
   * A recurring expense to change, by id — the Recurring screen's Edit. The
   * same form, opened on the rule with Repeats on; see `EditingRule`.
   */
  rule?: string;
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

  const [
    participants,
    categoryMappings,
    frequentCategories,
    balances,
    locale,
    recentExpenses,
    preferredCurrency,
    usualPaymentMethod,
  ] = await Promise.all([
    listParticipants(access.groupId),
    loadMappings(access),
    loadFrequentCategories(access),
    loadGroupBalances(access),
    // The amounts below are pre-formatted for the form, so they follow the
    // reader's notation rather than their language.
    getNumberLocale(),
    /*
     * The last handful of entries, for the "did I already log this?" line.
     *
     * Twenty is enough: the note only looks two days back, and a group
     * adding more than twenty entries in two days is one where the reader
     * is already watching the list. Loaded here rather than fetched from
     * the drawer because the drawer is a route and this is one query.
     */
    listExpenses(access.groupId, { limit: 20 }),
    /*
     * Only ever consulted for a group with no base currency and no entries
     * yet, so it never decides anything in a group that is already running —
     * but it is what stops the very first expense of a new group opening in
     * the wrong currency. A guest has no account and so has no preference.
     */
    access.actor.kind === "user"
      ? getUserPreferredCurrency(access.actor.userId)
      : null,
    /*
     * How this group has usually paid, for the hint over the method tiles. One
     * grouped count on an index the settle list already uses, loaded with
     * everything else rather than fetched from the drawer — the drawer is a
     * route, and a hint that arrives after the tiles is a hint nobody reads.
     */
    mostUsedPaymentMethod(access.groupId),
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

  /*
   * Everyone the balances know, removed people included. A person removed
   * with money outstanding — an old entry of theirs edited or deleted since —
   * is still a row in the list below, and a row with no name is not one
   * anybody can settle.
   */
  const names = balances.participantNames;

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
  const recentEntries = toRecentEntries(recentExpenses, locale);

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
  const selfId = access.participantId ?? participants[0].id;
  const rule = ruleId
    ? await loadRule(
        access.groupId,
        ruleId,
        participants.map((participant) => participant.id),
        selfId,
      )
    : undefined;
  // Null only ever comes back from a load that was asked for: an entry that is
  // not in this group, or has already been removed under the reader.
  if (editing === null || rule === null) {
    if (whenGone === "nothing") return null;
    notFound();
  }

  const members = participants.map((participant) => ({
    id: participant.id,
    displayName: participant.displayName,
    // Somebody in the group's money but not on the instance. It changes
    // nothing about the split maths — only what their avatar looks like.
    guest: participant.userId === null,
  }));
  /*
   * An entry being edited also offers anyone on it who has left the group
   * since. The server lets an edit keep them and refuses only adding them
   * somewhere new, so the form shows them rather than carrying them along
   * unseen: a split that counted a person nobody could see or untick, and a
   * payer with no name beside the amount they paid.
   *
   * Only here. The offline snapshot and a new entry get the group as it is.
   */
  const stillHere = new Set(members.map((member) => member.id));
  const leftSince = editing
    ? [...new Set(peopleOn(editing))].filter((id) => !stillHere.has(id))
    : [];
  const formMembers = [
    ...members,
    ...leftSince.map((id) => ({
      id,
      displayName: balances.participantNames.get(id) ?? "",
    })),
  ];
  /*
   * The group's own habit outranks any constant: `currencyMode: "separate"`
   * leaves `baseCurrency` null, and a hardcoded fallback then opened this
   * drawer on EUR in groups whose every balance was in francs. Balances carry
   * one row per currency the group has ever moved money in, which is exactly
   * the signal, and they are already loaded above.
   */
  const defaultEntryCurrency = defaultCurrency({
    editing: editing?.currency,
    base: access.group.baseCurrency,
    used: balances.currencies.map((entry) => ({
      currency: entry.currency,
      weight: entry.totalOutstanding,
    })),
    preferred: preferredCurrency,
  });

  return (
    <>
      {/* Keeps a copy of exactly these inputs on the device, so this same form
          can open with no network at all. See `SnapshotCapture`. */}
      <SnapshotCapture
        groupId={access.groupId}
        groupName={access.group.name}
        members={members}
        selfId={selfId}
        // Not a form prop: whose copy this is, so an entry queued from it on
        // the offline screen is sent as them. See `snapshotActor`.
        userId={access.actor.kind === "user" ? access.actor.userId : null}
        currencyMode={access.group.currencyMode}
        baseCurrency={access.group.baseCurrency}
        defaultCurrency={defaultEntryCurrency}
        timezone={access.group.timezone}
        frequentCategories={frequentCategories}
      />
      <AddEntryDrawer
        dismissTo={dismissTo}
        groupId={access.groupId}
        groupName={access.group.name}
        members={formMembers}
        selfId={selfId}
        currencyMode={access.group.currencyMode}
        baseCurrency={access.group.baseCurrency}
        defaultCurrency={defaultEntryCurrency}
        timezone={access.group.timezone}
        outstanding={outstanding}
        usualPaymentMethod={usualPaymentMethod}
        categoryMappings={categoryMappings}
        frequentCategories={frequentCategories}
        semanticCategorization={isSemanticCategorizationEnabled()}
        receiptScanning={isReceiptScanningEnabled()}
        receiptOcrLocal={isLocalReceiptOcrEnabled()}
        // The provider's *name*, so the interface can say where a photograph
        // is going. Its key stays on the server and is never sent here.
        receiptOcrProvider={configuredOcrProviderName()}
        editing={editing}
        rule={rule}
        // A rule is an expense or an income, never a repayment.
        entryTypes={rule ? RULE_TYPES : undefined}
        recentEntries={recentEntries}
        canAddGuests={access.permissions.manageParticipants}
        // Not for a rule: its split is the thing being corrected, and saving
        // it should not quietly become the group's way of splitting things.
        defaultSplit={
          rule
            ? null
            : groupSplitDefault(
                access.group.defaultSplit,
                participants.map((participant) => participant.id),
              )
        }
      />
    </>
  );
}

/**
 * The last few expenses, as the duplicate note wants them.
 *
 * Spending only — matching rent received against a grocery expense is a false
 * positive by construction, and the line is worth having only while it is
 * rarely wrong.
 *
 * A plain function rather than part of the component, because it reads the
 * clock: ages are stamped once per request here so the client compares
 * numbers instead of re-deriving "now" on every keystroke.
 */
function toRecentEntries(
  expenses: readonly ExpenseSummary[],
  locale: string,
): RecentEntry[] {
  const now = Date.now();
  return expenses
    .filter((expense) => expense.direction === "out")
    .map((expense) => ({
      id: expense.id,
      description: expense.description,
      amountMinor: expense.amount.toString(),
      currency: expense.currency,
      amountFormatted: formatMoney(money(expense.amount, expense.currency), {
        locale,
      }),
      payerName: expense.payers[0]?.displayName ?? "",
      category: expense.category ?? "",
      hoursAgo: (now - expense.createdAt.getTime()) / 3_600_000,
    }));
}

/** Everyone an entry names: its payers, its split, and a repayment's two sides. */
function peopleOn(entry: EditingEntry): string[] {
  return [
    ...(entry.payerId ? [entry.payerId] : []),
    ...(entry.payers ?? []).map((payer) => payer.participantId),
    ...(entry.settleTo ? [entry.settleTo] : []),
    ...entry.includedIds,
  ];
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
    subcategory: expense.subcategory ?? "",
    notes: expense.notes ?? "",
    payerId: expense.payers[0]?.participantId ?? null,
    // All of them, so reopening a two-payer expense does not rewrite it as a
    // one-payer one. See `EditingEntry.payers`.
    payers: expense.payers.map((payer) => ({
      participantId: payer.participantId,
      amountText: toMajorString(money(payer.amount, expense.currency)),
    })),
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
    version: expense.version,
  };
}

/** What a rule can be: an expense or an income. */
const RULE_TYPES: readonly EntryType[] = ["expense", "income"];

/**
 * A recurring expense as the form reopens it — or null when it is not in this
 * group or has been removed.
 *
 * Its people are checked against the group as it is now, the way a restored
 * draft's are: a flatmate who has left is not offered back, because the
 * worker cannot add an entry that names them and the save would refuse them.
 * Changing who is in the split after somebody leaves is the commonest reason
 * to open a rule at all. A payer who has left gives way to the reader, who is
 * the one making the change.
 */
async function loadRule(
  groupId: string,
  templateId: string,
  memberIds: readonly string[],
  selfId: string,
): Promise<EditingRule | null> {
  // An address somebody typed is not an id until it parses as one, and the
  // column would answer anything else with an error rather than a miss.
  if (!z.uuid().safeParse(templateId).success) return null;
  const template = await getRecurringExpense(groupId, templateId);
  if (!template) return null;

  const live = new Set(memberIds);
  const currency = template.currency;
  const entries = template.splitEntries.filter((entry) =>
    live.has(entry.participantId),
  );
  const payers = template.payers.filter((payer) =>
    live.has(payer.participantId),
  );
  const asText = (minor: string) =>
    toMajorString(money(BigInt(minor), currency));

  return {
    id: template.id,
    fields: {
      type: template.direction === "in" ? "income" : "expense",
      amountText: toMajorString(money(template.amount, currency)),
      currency,
      description: template.description,
      notes: template.notes ?? "",
      category: template.category ?? "",
      subcategory: template.subcategory ?? "",
      categoryChosen: (template.category ?? "") !== "",
      date: template.edit.from,
      payerId: payers[0]?.participantId ?? selfId,
      includedIds: entries.map((entry) => entry.participantId),
      splitMethod: template.splitMethod,
      splitValues: splitValuesToText(template.splitMethod, entries, currency),
      recurrence: {
        enabled: true,
        frequency: template.frequency,
        interval: template.interval,
        weekday: template.weekday ?? 1,
        dayOfMonth:
          template.dayOfMonth ?? Number(template.startDate.slice(8, 10)),
        weekOfMonth: template.weekOfMonth,
        endDate: template.endDate,
        count: template.occurrenceCount,
      },
      attachmentIds: [],
    },
    exchangeRate: template.exchangeRate ?? "",
    payers:
      payers.length > 1
        ? payers.map((payer) => ({
            participantId: payer.participantId,
            amountText: asText(payer.amount),
          }))
        : undefined,
    earliest: template.edit.earliest,
    paused: template.pausedAt !== null,
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
    // A repayment has no category, so it has nothing under one either.
    subcategory: "",
    notes: settlement.notes ?? "",
    payerId: settlement.fromParticipantId,
    settleTo: settlement.toParticipantId,
    includedIds: [],
    splitMethod: "equal",
    splitValues: {},
    paymentMethod: settlement.paymentMethod ?? "",
    version: settlement.version,
  };
}
