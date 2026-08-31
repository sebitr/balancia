"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useDateFormatter, useNumberLocale } from "@/i18n/format-context";
import {
  AlignLeft,
  CalendarDays,
  Loader2,
  Repeat,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  openOnContent,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toastUndoable } from "@/components/ui/sonner";
import { ScanReceiptEntry } from "@/components/receipts/scan-receipt-entry";
import type { ScannedExpense } from "@/components/receipts/scan-receipt-dialog";
import { useCategorySuggestion } from "@/components/expenses/use-category-suggestion";
import {
  formatMinorUnits,
  parseAmountToMinor,
  previewSplit,
  suggestExactValues,
  suggestPercentages,
  type SplitMessage,
} from "@/components/expenses/expense-form-logic";
import { cn } from "@/lib/utils";
import { formatMoney, money } from "@/modules/currencies/money";
import {
  isValidSubcategoryFor,
  type LearnedMerchantMapping,
} from "@/modules/categorization";
import type { SplitMethod } from "@/modules/expenses/split";
import {
  convertExpenseToSettlementAction,
  convertSettlementToExpenseAction,
  createExpenseAction,
  createSettlementAction,
  deleteExpenseAction,
  deleteSettlementAction,
  restoreExpenseAction,
  restoreSettlementAction,
  updateExpenseAction,
  updateSettlementAction,
} from "@/modules/expenses/actions";
import { createRecurringAction } from "@/modules/recurring/actions";
import { isKnownPayoutMethod } from "@/modules/payouts/fields";
import {
  PAYMENT_METHOD_IDS,
  countryForTimezone,
  methodsForCountry,
  type PaymentMethodId,
} from "@/modules/settlements/payment-methods";
import { AmountCard } from "./amount-card";
import { AttachFile, type EntryAttachment } from "./attach-file";
import { CategorySheet } from "./category-sheet";
import { useVocabulary } from "./vocabulary";
import { CurrencyPicker } from "@/components/money/currency-picker";
import {
  confirmationKey,
  directionOf,
  hasAmount,
  noteAfterTypeSwitch,
  primaryActionKey,
  resetsForType,
  sanitiseAmount,
  summariseSplit,
  type EntryType,
} from "./entry-logic";
import { ALL_ENTRY_TYPES, EntryTypeTabs } from "./entry-type-tabs";
import { enqueueEntry } from "@/lib/offline/outbox";
import { randomKey } from "@/lib/offline/idb";
import { ScanBanner, ScanCard, ReceiptItems } from "./receipt-blocks";
import {
  RecurrenceSheet,
  upcomingOccurrences,
  type RecurrenceState,
} from "./recurrence-sheet";
import { RowCard, Row, RowButton } from "./row-card";
import { describeSplit } from "./split-notes";
import { SplitSheet } from "./split-sheet";
import { SplitSummaryRow } from "./split-summary-row";
import {
  OutstandingList,
  PairPicker,
  PairSheet,
  PaymentMethodRow,
  PaymentMethodSheet,
  type DebtPair,
} from "./settle-blocks";
import { settleOutcome, type SettleOutcome } from "./settle-outcome";
import { savedSummary } from "./saved-summary";
import { findDuplicate, type RecentEntry } from "./duplicate-note";
import { useDebounced } from "./use-debounced";
import type { EntryMember } from "./pills";

/**
 * One adaptive form for expense, income and settlement.
 *
 * The shape of the screen is the argument: the 90% path is amount,
 * description, add — three taps — and everything else is collapsed until it is
 * needed. Paid-by and split are one summary row that opens a sheet. Category
 * is a chip. Recurrence is a pill. None of them cost vertical space until
 * somebody disagrees with the default, which is what keeps the primary button
 * on screen without scrolling.
 *
 * Type is a segmented control rather than three routes because the three share
 * almost every field, and someone who picked wrong should not lose what they
 * typed. Only the amount colour, one middle block and the primary button
 * change with it.
 *
 * State lives here and is passed down; the pieces below are presentational.
 * Only one sheet can be open at a time — a single value, not a set of
 * booleans, so two sheets cannot both believe they are showing.
 *
 * The form owns the drawer's chrome as well as its body, because the title and
 * the primary button both change with the type and neither is worth lifting
 * into a shell that would then need told about it. What the shell owns is the
 * sheet itself: see `add-entry-drawer`.
 *
 * Editing reopens this same screen with `editing` filled in rather than a
 * screen of its own. There used to be a second form for it, and the two drifted
 * exactly as far apart as you would expect: one had a receipt scanner, item
 * splitting, a category picker that guessed and a currency list, the other had
 * four dropdowns and could not change an entry's type at all. One form means an
 * edit can do everything adding can, and it means a fix to either is a fix to
 * both.
 */

type OpenSheet =
  null | "split" | "category" | "currency" | "method" | "recur" | "pair";

/**
 * An entry that already exists, as the fields that put it back on screen.
 *
 * Flat and already-formatted rather than the stored row: the two tables an
 * entry can live in have little in common past an amount and a date, and the
 * screen's business is fields. Whichever table it came from is `kind`, and it
 * is the only thing here the form cannot infer — saving has to know whether the
 * type it ends on still matches the table it started in.
 */
export interface EditingEntry {
  readonly kind: "expense" | "settlement";
  readonly id: string;
  readonly type: EntryType;
  /** Major units, as the reader would type them. */
  readonly amountText: string;
  readonly currency: string;
  readonly exchangeRate: string;
  readonly date: string;
  readonly description: string;
  readonly category: string;
  /** Only meaningful against `category`; "" when nobody was more specific. */
  readonly subcategory: string;
  /**
   * A repayment's description, and an expense's notes.
   *
   * One field because it is one column on each of the two tables. The settle
   * tab shows it and lets it be typed; the expense tabs have nowhere to put it
   * and hand back whatever they were given, which is how an imported entry
   * keeps notes that only its detail screen ever shows.
   */
  readonly notes: string;
  readonly payerId: string | null;
  /**
   * The other side of a repayment. `payerId` is the one paying.
   *
   * Null on an expense, which has no second side until somebody says it was
   * really a repayment — and then it is the one thing they have to answer.
   */
  readonly settleTo: string | null;
  readonly includedIds: readonly string[];
  readonly splitMethod: SplitMethod;
  readonly splitValues: Readonly<Record<string, string>>;
  /** The stored label, which may predate the picker's list. */
  readonly paymentMethod: string;
}

/**
 * What a save produced: the action's answer, and — when the entry changed
 * tables — the screen it now lives on.
 *
 * The id in the URL belongs to the row the conversion has just removed, so
 * where the entry went is only ever knowable from what the action hands back.
 * Typed by the shape the form reads rather than imported from the server's
 * `ActionResult`, which would drag a server module into this bundle.
 */
interface Outcome {
  readonly result: {
    readonly ok: boolean;
    readonly error?: string;
    /**
     * What the action created, when it created something.
     *
     * Only the two `create` actions carry an id, and only that id gives the
     * confirmation somewhere to link back to. An update already knows where
     * it lives; a queued entry has no id until it syncs.
     */
    readonly data?: unknown;
  };
  readonly movedTo?: string;
}

/**
 * The expense an action just created, if it created one.
 *
 * `ActionResult` is generic over its payload and the four submit paths return
 * four different ones, so the shape is checked here rather than widened at
 * every return. Anything else — an update, a settlement, a queued entry —
 * simply has no id to offer, and the confirmation states its facts without
 * linking them.
 */
function createdExpenseId(result: {
  readonly data?: unknown;
}): string | undefined {
  const data = result.data;
  if (typeof data !== "object" || data === null) return undefined;
  const id = (data as { expenseId?: unknown }).expenseId;
  return typeof id === "string" ? id : undefined;
}

const NO_MAPPINGS: readonly LearnedMerchantMapping[] = [];
/** A group with nothing in it yet: the duplicate note has nothing to match. */
const NO_RECENT: readonly RecentEntry[] = [];

/**
 * How long the fields have to hold still before the duplicate note appears.
 *
 * Long enough that typing an amount digit by digit does not flash it on and
 * off; short enough that it is there by the time somebody looks up.
 */
const DUPLICATE_DEBOUNCE_MS = 500;
/** A group with no history yet — the picker simply has nothing to lead with. */
const NO_FREQUENT: readonly string[] = [];

export interface AddEntryFormProps {
  groupId: string;
  /**
   * The group's name, carried only so a queued entry can say which group it
   * belongs to while there is no server to ask. Optional because every screen
   * that renders this form already shows the name in its own chrome.
   */
  groupName?: string;
  members: readonly EntryMember[];
  /** The reader, who is the default payer. */
  selfId: string;
  currencyMode: "separate" | "converted";
  baseCurrency: string | null;
  defaultCurrency: string;
  /** Group timezone — the recurrence schedule and the country both read it. */
  timezone: string;
  /** Outstanding debts, most owed first, for the settle tab. */
  outstanding: readonly DebtPair[];
  /**
   * Which entry types this screen can offer. All three by default; the offline
   * drawer passes the two that need no server. See `EntryTypeTabs`.
   */
  entryTypes?: readonly EntryType[];
  categoryMappings?: readonly LearnedMerchantMapping[];
  /** What this group files things under, most used first, for the picker. */
  frequentCategories?: readonly string[];
  semanticCategorization?: boolean;
  receiptScanning?: boolean;
  /** Whether the on-device reader is switched on (`RECEIPT_OCR_LOCAL`). */
  receiptOcrLocal?: boolean;
  /** The configured server-side reader, named. Never a key. */
  receiptOcrProvider?: string;
  /**
   * The entry being changed, when there is one. Absent means a new entry.
   */
  editing?: EditingEntry;
  /**
   * A repayment the screen that opened this drawer already stated.
   *
   * The settle-up screen and the overview's settlement list both name a debt
   * before anybody taps it, so the form opens on the settle tab with that pair
   * already picked instead of asking the same question twice.
   *
   * `amountMinor` is what is outstanding *now*, read by the route rather than
   * copied off the URL — null when the debt has since been cleared, which
   * leaves the two people named and the amount for the reader to type. Never
   * set together with `editing`: one is an entry that exists, the other a
   * suggestion for one that does not.
   */
  prefill?: {
    readonly fromParticipantId: string;
    readonly toParticipantId: string;
    readonly amountMinor: string | null;
    readonly currency: string;
    /**
     * The payout method the settle screen was showing when it was tapped, as
     * a `PaymentMethodId`. Null from every other link into this drawer, and
     * from a settle screen whose reader never picked one.
     */
    readonly method: string | null;
  };
  /** Dismisses the drawer. Supplied by the shell, never by a route. */
  onClose?: () => void;
  /**
   * Dismisses it too, but on a saved entry.
   *
   * Separate from `onClose` because the group behind is now out of date, and
   * only the shell knows when the drawer has finished leaving — which is the
   * earliest a refresh can be aimed at the group rather than at this route.
   */
  onSaved?: () => void;
  /**
   * Dismisses it on an entry that no longer exists — deleted, or moved to the
   * other table by a change of type. Separate from `onSaved` because the shell
   * cannot go back to a screen that has just been removed underneath it.
   *
   * `to` is where the entry went, when it went somewhere: a conversion writes
   * a new row in the other table, and its detail screen is the one thing the
   * reader actually wants to see afterwards. A deletion leaves nothing to look
   * at and passes nothing.
   */
  onRemoved?: (to?: string) => void;
  /**
   * A sheet to open with the drawer, named by whoever linked here.
   *
   * Only the confirmation uses it today — see `describeSaved`. Absent for
   * every other way in, which is all of them.
   */
  openSheet?: OpenSheet;
  /**
   * The group's last few entries, for the duplicate note.
   *
   * Empty is the ordinary state of a new group and simply means the note
   * never appears.
   */
  recentEntries?: readonly RecentEntry[];
}

export function AddEntryForm({
  groupId,
  groupName = "",
  members,
  selfId,
  currencyMode,
  baseCurrency,
  defaultCurrency,
  timezone,
  outstanding,
  entryTypes = ALL_ENTRY_TYPES,
  categoryMappings = NO_MAPPINGS,
  frequentCategories = NO_FREQUENT,
  semanticCategorization = false,
  receiptScanning = false,
  receiptOcrLocal = true,
  receiptOcrProvider,
  editing,
  prefill,
  onClose,
  onSaved,
  onRemoved,
  openSheet,
  recentEntries = NO_RECENT,
}: AddEntryFormProps) {
  const router = useRouter();
  const locale = useNumberLocale();
  const dates = useDateFormatter();
  const t = useTranslations("addEntry");
  const tSplit = useTranslations("expenses.split");
  const tMethods = useTranslations("paymentMethods");
  const tCommon = useTranslations("common");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const repeatsId = useId();

  const splitText = (message: SplitMessage) =>
    tSplit(message.key, message.params);

  /*
   * A drawer opened from a stated debt starts where that debt left off: the
   * settle tab, both names, the outstanding figure and the currency it is owed
   * in. Seeded as initial state rather than applied in an effect, so the first
   * paint is already the filled form — an empty expense tab that rearranges
   * itself a frame later reads as the screen changing its mind.
   */
  const [type, setType] = useState<EntryType>(
    editing?.type ?? (prefill ? "settle" : "expense"),
  );
  const [amountText, setAmountText] = useState(
    editing?.amountText ??
      (prefill?.amountMinor
        ? formatMinorUnits(prefill.amountMinor, prefill.currency)
        : ""),
  );
  const [currency, setCurrency] = useState(
    editing?.currency ?? prefill?.currency ?? defaultCurrency,
  );
  const [rate, setRate] = useState(editing?.exchangeRate ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  /**
   * What a repayment was for — the column has always called it notes.
   *
   * Kept apart from `description` rather than folded into it, because an
   * expense carries notes of its own that this screen never shows. Sharing one
   * value would let a tab switch overwrite an imported note with a title, and
   * the reader would never see it happen. What a switch to settle does instead
   * is move the title in when there is no note to displace, and take it back
   * out again on the way to an expense: `noteAfterTypeSwitch`.
   */
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  // A category already on the entry is a decision somebody made, whoever made
  // it. Leaving it open to the classifier would let reopening an entry
  // silently refile it the moment the description was touched.
  const [categoryChosen, setCategoryChosen] = useState(
    (editing?.category ?? "") !== "",
  );
  const [subcategory, setSubcategory] = useState(editing?.subcategory ?? "");
  const [date, setDate] = useState(
    () => editing?.date ?? new Date().toISOString().slice(0, 10),
  );

  const [payerId, setPayerId] = useState(editing?.payerId ?? selfId);
  // A settlement has no split of its own, so it seeds the full membership: a
  // reader who switches to something that does split starts where a new entry
  // would rather than with a single name selected.
  const [includedIds, setIncludedIds] = useState<readonly string[]>(() =>
    editing && editing.includedIds.length > 0
      ? [...editing.includedIds]
      : members.map((member) => member.id),
  );
  const [method, setMethod] = useState<SplitMethod>(
    editing?.splitMethod ?? "equal",
  );
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...editing?.splitValues,
  }));
  /** Set once per-item assignment has written exact amounts. */
  const [byItem, setByItem] = useState(false);

  const [recurrence, setRecurrence] = useState<RecurrenceState>({
    enabled: false,
    frequency: "monthly",
    interval: 1,
    weekday: 1,
    dayOfMonth: Number(new Date().toISOString().slice(8, 10)),
    endDate: null,
  });

  const [scan, setScan] = useState<ScannedExpense | null>(null);
  const [bannerVisible, setBannerVisible] = useState(false);
  /** Uploaded as they are chosen; linked to the entry when it is saved. */
  const [attachments, setAttachments] = useState<readonly EntryAttachment[]>(
    [],
  );

  /**
   * Who is repaying whom, as two people rather than as a debt.
   *
   * Held apart from `outstanding` because the two are only the same thing while
   * the repayment is new. Reopening one is asking about a debt that this very
   * settlement has already cleared, so it cannot be a row in that list — and
   * correcting the wrong name means picking somebody who never owed anything.
   * The list still writes here; it is one way to answer, not the state itself.
   *
   * Empty until the settle tab is reached, and left empty for an expense being
   * turned into one: there is no honest guess at who was repaid, and filling it
   * from the group's largest debt would put two names on the screen that nobody
   * chose and that a reader has every reason to take for the entry's own.
   */
  const [settleFrom, setSettleFrom] = useState<string | null>(
    () => editing?.payerId ?? prefill?.fromParticipantId ?? null,
  );
  const [settleTo, setSettleTo] = useState<string | null>(
    () => editing?.settleTo ?? prefill?.toParticipantId ?? null,
  );
  /**
   * How the money moved, held as the words that will be stored.
   *
   * The column takes a label rather than a code — deliberately, so a
   * settlement still says "TWINT" years after the picker's list has moved on —
   * and holding the same thing here means the two cases that used to need
   * separate handling are one: a method tapped from the list and a name typed
   * by hand are both simply text, and reopening either reads it straight back.
   */
  const [methodLabel, setMethodLabel] = useState(() => {
    if (editing) return editing.paymentMethod.trim();
    // The chip the reader chose on the settle screen, in the words this locale
    // calls it. A code arrives on the URL and a label is what gets stored, so
    // the translation happens here, once, on the way in — leaving exactly the
    // state a tap on this form's own picker would have produced.
    const picked = prefill?.method ?? "";
    return isKnownPayoutMethod(picked) ? tMethods(picked) : "";
  });

  /*
   * The confirmation links back here with the sheet that fixes the fact
   * already open, so a reader who spots a wrong payer is one tap from the
   * roster rather than four. Seeded as initial state rather than opened in an
   * effect: a drawer that appears and then opens a sheet a frame later reads
   * as two screens.
   */
  const [sheet, setSheet] = useState<OpenSheet>(openSheet ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const country = countryForTimezone(timezone);
  const countryMethods = useMemo(() => methodsForCountry(country), [country]);
  /** The chosen method, when the picker has a chip for it. */
  const methodId = matchPaymentMethod(methodLabel, tMethods);
  /**
   * A label the picker cannot name — typed here, or imported, or a provider
   * since dropped from the list. Either way it is the truth about how the
   * money moved, so it is shown as the choice and written back unchanged.
   */
  const customMethod = methodId === null ? methodLabel : "";

  /*
   * Which vocabulary the category row is speaking.
   *
   * A settlement has no category at all, so it borrows spending's — nothing
   * reads it, and leaving the picker with no list to draw would be a state
   * with no right answer rather than no state.
   */
  const categoryDirection = directionOf(type) ?? "out";
  const vocabulary = useVocabulary(categoryDirection);

  const suggestion = useCategorySuggestion({
    description,
    notes: "",
    mappings: categoryMappings,
    semanticEnabled: semanticCategorization,
    direction: categoryDirection,
  });
  const detectedCategory =
    !categoryChosen && suggestion?.decision === "auto_assigned"
      ? (suggestion.category ?? "")
      : "";
  const effectiveCategory = categoryChosen ? category : detectedCategory;
  /**
   * The subcategory that goes with whichever category is in force.
   *
   * A chosen category carries the chosen child; a detected one carries the
   * classifier's, which it only offers when a rule named it outright. Either
   * way the child is discarded the moment it does not belong to the parent —
   * the pair is checked here as well as on the server, so a stale value can
   * never be *shown* under a category it does not belong to either.
   */
  const effectiveSubcategory = categoryChosen
    ? subcategory
    : detectedCategory !== ""
      ? (suggestion?.subcategory ?? "")
      : "";
  const shownSubcategory = isValidSubcategoryFor(
    categoryDirection,
    effectiveCategory,
    effectiveSubcategory,
  )
    ? effectiveSubcategory
    : "";

  const isSettle = type === "settle";
  const isIncome = type === "income";
  /**
   * What the entry's row has to become, against the table it is in today.
   *
   * Expense and income are the same row with a sign, so moving between them is
   * an update. A repayment is a different table on purpose, so the same tab tap
   * on an existing entry has to write one and remove the other.
   */
  const converting =
    editing !== undefined &&
    editing.kind !== (isSettle ? "settlement" : "expense");
  /** An entry that already exists cannot become a template for future ones. */
  const canRepeat = !isSettle && editing === undefined;
  /**
   * The pair, once it is one: two different people, both named.
   *
   * Half an answer is a legitimate thing to be in the middle of — an expense
   * being turned into a repayment starts with only the payer — so this is null
   * until it is whole, and the primary button stays disabled meanwhile.
   */
  const selectedPair = useMemo(() => {
    if (settleFrom === null || settleTo === null) return null;
    if (settleFrom === settleTo) return null;
    const nameOf = (id: string) =>
      members.find((member) => member.id === id)?.displayName ?? "";
    return {
      fromParticipantId: settleFrom,
      fromName: nameOf(settleFrom),
      toParticipantId: settleTo,
      toName: nameOf(settleTo),
    };
  }, [settleFrom, settleTo, members]);

  /**
   * A pair the reader named, rather than one the balances produced.
   *
   * Per entry and never saved to the group: cleared on save, on cancel, on
   * "Add another" and on switching the type away from Settle. In storage it is
   * an ordinary settlement — see `DebtPair.isCustom`.
   */
  const [customPair, setCustomPair] = useState<DebtPair | null>(null);

  /**
   * What the pair sheet holds while it is open.
   *
   * Kept apart from the entry's own pair so that dismissing the sheet changes
   * nothing: half an answer is a legitimate thing to be in the middle of, and
   * writing it straight through would leave the form pointing at a person
   * with nobody to pay.
   */
  const [draftPair, setDraftPair] = useState<{
    fromId: string | null;
    toId: string | null;
  }>({ fromId: null, toId: null });

  /** The sheet's two names as a pair, or null while it is half-answered. */
  const pairFrom = (draft: {
    fromId: string | null;
    toId: string | null;
  }): DebtPair | null => {
    const { fromId, toId } = draft;
    if (fromId === null || toId === null || fromId === toId) return null;
    const nameOf = (id: string) =>
      members.find((member) => member.id === id)?.displayName ?? "";
    return {
      fromParticipantId: fromId,
      fromName: nameOf(fromId),
      toParticipantId: toId,
      toName: nameOf(toId),
      amountMinor: "0",
      currency: baseCurrency ?? defaultCurrency,
      amountFormatted: "",
      isCustom: true,
    };
  };

  /**
   * The rows the outstanding card shows: the real debts, then the named pair.
   *
   * It joins the list rather than sitting beside it because it answers the
   * same question, and it stays selectable alongside the real ones.
   */
  const settlePairs = useMemo(
    () => (customPair ? [...outstanding, customPair] : outstanding),
    [outstanding, customPair],
  );

  /** Which row, if any, the current pair happens to be. */
  const outstandingIndex = settlePairs.findIndex(
    (pair) =>
      pair.fromParticipantId === settleFrom &&
      pair.toParticipantId === settleTo,
  );

  /**
   * Whether the pair is named from the whole group rather than from its debts.
   *
   * The outstanding list is the right way *in* to a new repayment, and it can
   * only ever show a debt that still exists. Two cases hold a pair it has no
   * row for: an entry being edited, whose own settlement already cleared the
   * debt it was for, and a drawer opened on a debt that somebody else settled
   * between the link being rendered and being followed. Showing the list to
   * either would leave two names selected with nothing on screen saying so.
   */
  const namesFromGroup =
    editing !== undefined || (settleFrom !== null && outstandingIndex < 0);

  const needsRate =
    currencyMode === "converted" &&
    baseCurrency !== null &&
    currency !== baseCurrency;

  const totalMinor = parseAmountToMinor(amountText || "0", currency);

  /*
   * Who the entry covers.
   *
   * There used to be a second answer here: an income mode called "mine only",
   * whose own hint said "nobody else's balance moves" — which is to say it did
   * nothing to the ledger. The need it looked like it served, income that is
   * not everyone's, is already expressible and more precisely: set Credited to
   * to the people who actually share it. So there is one answer, and it is the
   * roster.
   */
  const effectiveIncluded = includedIds;

  const preview = useMemo(
    () =>
      previewSplit({
        totalMinor: totalMinor.ok ? totalMinor.value : null,
        currency,
        method,
        participantIds: effectiveIncluded,
        values,
        locale,
      }),
    [totalMinor, currency, method, effectiveIncluded, values, locale],
  );

  const amountFormatted =
    totalMinor.ok && amountText !== ""
      ? formatMoney(money(totalMinor.value, currency), { locale })
      : formatMoney(money(0n, currency), { locale });

  const payerName =
    members.find((member) => member.id === payerId)?.displayName ?? "";

  const eachFormatted =
    preview.ok && preview.allocations.length > 0
      ? preview.allocations[0].formatted
      : null;

  const summary = summariseSplit({
    method,
    participantCount: effectiveIncluded.length,
    eachFormatted,
    byItem,
  });

  /**
   * What the split does not add up to, said out loud.
   *
   * Separate from `preview`, which only decides whether the split is valid.
   * This is the sentence under the per-person rows, and the one that tells
   * somebody *which way* they are out.
   */
  const splitNote = useMemo(
    () =>
      describeSplit({
        totalMinor: totalMinor.ok ? totalMinor.value : null,
        currency,
        method,
        participantIds: effectiveIncluded,
        values,
        absorberName:
          members.find((member) => member.id === effectiveIncluded[0])
            ?.displayName ?? "",
        locale,
      }),
    [totalMinor, currency, method, effectiveIncluded, values, members, locale],
  );

  /**
   * An empty split stays empty.
   *
   * Deselecting everybody is a legitimate thing to be in the middle of, so it
   * is never quietly repopulated — it just cannot be saved, and both the
   * summary row and the sheet say why.
   */
  const canSave =
    hasAmount(amountText) &&
    (isSettle ? selectedPair !== null : effectiveIncluded.length > 0);

  const upcoming = useMemo(
    () => upcomingOccurrences(recurrence, date, timezone),
    [recurrence, date, timezone],
  );

  /**
   * The dates the repeats row promises, as the reader writes dates.
   *
   * Day and month only, matching the recurrence sheet's own preview — three
   * full dates on one subline would wrap, and the year is the same for all of
   * them anyway.
   */
  const upcomingLabel = upcoming
    .map((day) => dates.plain(day, "dayMonth"))
    .join(", ");

  /** "Monthly, day 1" — the rule in one line, wherever it is named. */
  const repeatLabel = t("repeat.active", {
    frequency: t(`repeat.frequency.${recurrence.frequency}`),
    day:
      recurrence.frequency === "weekly"
        ? String(recurrence.weekday)
        : t("repeat.dayOfMonth", { day: recurrence.dayOfMonth }),
  });

  const amountLabel = scan
    ? t("labels.amountFromReceipt")
    : isSettle
      ? t("labels.payingBack")
      : isIncome
        ? t("labels.amountReceived")
        : t("labels.amount");

  /** Switching type throws away only what cannot survive the new one. */
  const changeType = (next: EntryType) => {
    const resets = resetsForType(next, type);
    setType(next);
    setNotes(noteAfterTypeSwitch({ from: type, to: next, description, notes }));
    setError(null);
    if (resets.clearCategory) {
      setCategory("");
      setSubcategory("");
      setCategoryChosen(false);
    }
    if (resets.clearScan) {
      setScan(null);
      setBannerVisible(false);
      setByItem(false);
    }
    if (resets.clearRecurrence) {
      setRecurrence((current) => ({ ...current, enabled: false }));
    }
    if (resets.clearAttachments) {
      setAttachments([]);
    }
    if (resets.resetCurrency) {
      setCurrency(baseCurrency ?? defaultCurrency);
      setRate("");
    }
    // A new repayment opens on the largest debt, which is the answer most of
    // the time and costs one tap to change. An entry that already exists opens
    // on its own people: what it says today is the thing being corrected, and
    // an edit that silently re-pointed the payment at the group's biggest debt
    // would be changing the one fact nobody asked it to.
    if (next === "settle" && !editing && selectedPair === null) {
      const pair = outstanding[0];
      if (pair) takePair(pair);
    }
    // A named pair belongs to the settlement being written, not to the
    // drawer. Leaving Settle ends it.
    if (next !== "settle") {
      setCustomPair(null);
      setDraftPair({ fromId: null, toId: null });
    }
  };

  /**
   * A repayment is denominated by the debt, not by the group.
   *
   * `resetsForType` sends a settlement back to the base currency, which is the
   * right default — but a group in `separate` mode has no base, and even one
   * that converts can hold a debt in something else. The pair carries its own
   * currency, and paying back 40 euros of a 40-euro debt should not have to be
   * retyped as francs.
   */
  const takePair = (pair: DebtPair) => {
    setSettleFrom(pair.fromParticipantId);
    setSettleTo(pair.toParticipantId);
    setCurrency(pair.currency);
    /*
     * Every other path into Settle prefills the exact figure; a named pair is
     * the exception, and deliberately. There is no balance to propose, so the
     * field has to ask rather than suggest — and "0.00" would be a suggestion.
     */
    setAmountText(
      pair.isCustom ? "" : formatMinorUnits(pair.amountMinor, pair.currency),
    );
  };

  const selectPair = (index: number) => {
    const pair = settlePairs[index];
    if (pair) takePair(pair);
  };

  /**
   * What this payment does to the ledger, as one sentence.
   *
   * Computed from the same values as the entry rather than described in
   * advance: a partial payment used to announce that the two of you were
   * settled, and a payment to somebody owed nothing announced the settling of
   * a debt that never existed.
   */
  /**
   * What the selected pair owes, or null when there is no figure to offer.
   *
   * Null covers both "nothing is selected" and "the pair is one the reader
   * named", which have no balance by definition.
   */
  /**
   * The recent entry this one might repeat, once the fields have settled.
   *
   * Debounced on the amount and the description together, so the line does
   * not flash while a figure is half-typed. Never while editing: an entry
   * being corrected necessarily matches itself.
   */
  const settledAmount = useDebounced(amountText, DUPLICATE_DEBOUNCE_MS);
  const settledDescription = useDebounced(description, DUPLICATE_DEBOUNCE_MS);
  const duplicate = useMemo(() => {
    if (type !== "expense" || editing) return null;
    const parsed = parseAmountToMinor(settledAmount || "0", currency);
    if (!parsed.ok) return null;
    return findDuplicate({
      amountMinor: parsed.value,
      currency,
      description: settledDescription,
      category: effectiveCategory,
      recent: recentEntries,
    });
  }, [
    type,
    editing,
    settledAmount,
    settledDescription,
    currency,
    effectiveCategory,
    recentEntries,
  ]);

  const settleBalance = useMemo(() => {
    const row =
      outstandingIndex >= 0 ? settlePairs[outstandingIndex] : undefined;
    if (!row || row.isCustom) return null;
    return BigInt(row.amountMinor);
  }, [settlePairs, outstandingIndex]);

  const outcome = useMemo(() => {
    const row =
      outstandingIndex >= 0 ? settlePairs[outstandingIndex] : undefined;
    return settleOutcome({
      pair:
        selectedPair && row
          ? {
              fromName: selectedPair.fromName,
              toName: selectedPair.toName,
              owedMinor: row.isCustom ? 0n : BigInt(row.amountMinor),
              isCustom: row.isCustom === true,
            }
          : null,
      amountMinor: totalMinor.ok ? totalMinor.value : 0n,
      hasMethod: methodLabel !== "",
    });
  }, [selectedPair, settlePairs, outstandingIndex, totalMinor, methodLabel]);

  /** Switching split method seeds sensible values instead of empty fields. */
  const changeMethod = (next: SplitMethod) => {
    setMethod(next);
    setByItem(false);
    if (next === "exact" && totalMinor.ok) {
      setValues(
        suggestExactValues(totalMinor.value, currency, effectiveIncluded),
      );
    } else if (next === "percentage") {
      setValues(suggestPercentages(effectiveIncluded));
    } else if (next === "shares") {
      setValues(Object.fromEntries(effectiveIncluded.map((id) => [id, "1"])));
    }
  };

  /**
   * Fills the form from a scan.
   *
   * The scanner already produces an exact split, so from here a scanned entry
   * is indistinguishable from a typed one and the server recomputes the same
   * allocations either way. Paid-by is untouched: a receipt says what was
   * bought, never who put the card in the machine.
   */
  const applyScan = (result: ScannedExpense) => {
    if (result.description !== "") setDescription(result.description);
    setAmountText(result.amount);
    setCurrency(result.currency);
    setDate(result.date);
    setMethod("exact");
    setIncludedIds([...result.participantIds]);
    setValues(result.splitValues);
    setByItem(true);
    setScan(result);
    setBannerVisible(true);
  };

  const onSubmit = async () => {
    setError(null);
    if (!totalMinor.ok) {
      setError(splitText(totalMinor.error));
      return;
    }
    if (!isSettle && description.trim() === "") {
      setError(t("errors.descriptionRequired"));
      return;
    }
    if (isSettle && !selectedPair) {
      setError(t("errors.choosePair"));
      return;
    }
    if (!isSettle && !preview.ok) {
      setError(preview.error ? splitText(preview.error) : null);
      return;
    }

    setPending(true);
    try {
      /*
       * One key per press of the button, minted before anything is sent and
       * used by whichever path the entry ends up taking. See
       * `createExpenseAction` for why the online path carries it too.
       */
      const clientKey = queueable ? randomKey() : undefined;

      // The browser says there is no network, so do not spend a request
      // finding out. Nothing is lost by being wrong here: the queue drains on
      // the next reconnect, which for a false alarm is seconds away.
      if (clientKey && !navigator.onLine) {
        await queueEntry(clientKey);
        return;
      }

      let outcome: Outcome;
      try {
        outcome = isSettle
          ? await submitSettlement()
          : recurrence.enabled
            ? await submitRecurring()
            : await submitEntry(clientKey);
      } catch (cause) {
        /*
         * The request did not come back. That covers a connection that dropped
         * mid-flight as well as one that never opened, and — the case worth
         * naming — a write the server committed whose answer was lost. All
         * three go in the queue under the key the attempt already used, so the
         * third writes nothing when it replays.
         *
         * Only what can be queued is caught. An editing or settling form has
         * no offline path, and swallowing its failure would tell somebody
         * their change was saved when it was not.
         */
        if (!clientKey) throw cause;
        await queueEntry(clientKey);
        return;
      }
      const { result, movedTo } = outcome;

      if (!result.ok) {
        setError(result.error ?? t("errors.saveFailed"));
        return;
      }
      // The confirmation follows the reader back to the group rather than
      // holding the drawer open in front of it: what they wanted to see is the
      // entry landing in the list, and the toast says the same thing without
      // standing between them and it.
      toast.success(
        t(
          `saved.${confirmationKey(type, recurrence.enabled, editing !== undefined)}`,
        ),
        { description: describeSaved(createdExpenseId(result) ?? editing?.id) },
      );
      // A conversion removed the row this drawer was opened on, so it leaves
      // the way a deletion does rather than back onto a detail screen that no
      // longer has anything to show — and it says where the entry went, which
      // is a screen that does.
      const leave = converting
        ? onRemoved && (() => onRemoved(movedTo))
        : onSaved;
      if (leave) leave();
      else router.refresh();
    } finally {
      setPending(false);
    }
  };

  /**
   * Whether this save can fall back to the device.
   *
   * A new expense or income, and nothing else. The three exclusions are all
   * the same exclusion: an entry the server has never heard of is the only one
   * a device can hold on its own without having to be told what happened to it
   * meanwhile.
   *
   * Editing needs the row it is editing, which may have been changed or
   * deleted by somebody else since — that is the conflict this feature does
   * not have and does not want. A repayment needs balances, which are a
   * running total no snapshot can keep honest. A recurring template is not an
   * entry at all; it is an instruction to a server-side job.
   */
  const queueable = !isSettle && !recurrence.enabled && editing === undefined;

  /**
   * Keeps the entry on this device and says so.
   *
   * The confirmation is deliberately not the ordinary one. "Expense added" is
   * a claim about the group, and this is not that yet — it is a claim about
   * this phone. Somebody who reads the usual toast and closes the app is owed
   * an accurate one.
   */
  const queueEntry = async (clientKey: string) => {
    await enqueueEntry({
      clientKey,
      groupId,
      groupName,
      payload: expensePayload(),
    });
    toast.success(t("saved.queued"), { description: t("saved.queuedNote") });
    if (onSaved) onSaved();
    else router.refresh();
  };

  const splitEntries = () =>
    effectiveIncluded.map((id) => {
      if (method === "equal") return { participantId: id };
      if (method === "exact") {
        const parsed = parseAmountToMinor(values[id] ?? "", currency);
        return {
          participantId: id,
          value: parsed.ok ? parsed.value.toString() : "0",
        };
      }
      return { participantId: id, value: (values[id] ?? "0").trim() };
    });

  const submitEntry = async (clientKey?: string): Promise<Outcome> => {
    const input = expensePayload();
    if (!editing) {
      return { result: await createExpenseAction(groupId, input, clientKey) };
    }
    if (!converting) {
      return { result: await updateExpenseAction(groupId, editing.id, input) };
    }
    const result = await convertSettlementToExpenseAction(
      groupId,
      editing.id,
      input,
    );
    return {
      result,
      movedTo: result.data
        ? `/groups/${groupId}/expenses/${result.data.expenseId}`
        : undefined,
    };
  };

  const expensePayload = () => ({
    direction: directionOf(type) ?? "out",
    description: description.trim(),
    notes,
    category: effectiveCategory,
    subcategory: shownSubcategory,
    amount: totalMinor.ok ? totalMinor.value.toString() : "0",
    currency,
    exchangeRate: needsRate ? rate.trim() : "",
    expenseDate: date,
    payers: [
      {
        participantId: payerId,
        amount: totalMinor.ok ? totalMinor.value.toString() : "0",
      },
    ],
    splitMethod: method,
    splitEntries: splitEntries(),
    // The scan's own photograph, if it was kept, plus anything attached by
    // hand. Both arrived through the same endpoint and are linked the same
    // way; only the scanner knows the difference.
    attachmentIds: [
      ...(scan?.attachmentId ? [scan.attachmentId] : []),
      ...attachments.map((file) => file.id),
    ],
  });

  const submitRecurring = async (): Promise<Outcome> => ({
    result: await createRecurringAction(groupId, {
      direction: directionOf(type) ?? "out",
      description: description.trim(),
      notes: "",
      category: effectiveCategory,
      subcategory: shownSubcategory,
      amount: totalMinor.ok ? totalMinor.value.toString() : "0",
      currency,
      exchangeRate: needsRate ? rate.trim() : "",
      payers: [
        {
          participantId: payerId,
          amount: totalMinor.ok ? totalMinor.value.toString() : "0",
        },
      ],
      splitMethod: method,
      splitEntries: splitEntries(),
      frequency: recurrence.frequency,
      interval: recurrence.interval,
      weekday:
        recurrence.frequency === "weekly" ? recurrence.weekday : undefined,
      dayOfMonth:
        recurrence.frequency === "weekly" ? undefined : recurrence.dayOfMonth,
      startDate: date,
      endDate: recurrence.endDate ?? "",
    }),
  });

  const submitSettlement = async (): Promise<Outcome> => {
    const input = {
      fromParticipantId: selectedPair!.fromParticipantId,
      toParticipantId: selectedPair!.toParticipantId,
      amount: totalMinor.ok ? totalMinor.value.toString() : "0",
      currency,
      exchangeRate: needsRate ? rate.trim() : "",
      settledOn: date,
      paymentMethod: methodLabel,
      notes,
    };
    if (!editing) {
      return { result: await createSettlementAction(groupId, input) };
    }
    if (!converting) {
      return {
        result: await updateSettlementAction(groupId, editing.id, input),
      };
    }
    const result = await convertExpenseToSettlementAction(
      groupId,
      editing.id,
      input,
    );
    return {
      result,
      movedTo: result.data
        ? `/groups/${groupId}/settlements/${result.data.settlementId}`
        : undefined,
    };
  };

  /**
   * Puts a deleted entry back. It takes what was being edited as an argument
   * rather than reading `editing`, because by the time the Undo is pressed
   * this form has been closed and reopened on something else as often as not.
   */
  const onRestore = async (removed: EditingEntry) => {
    const result =
      removed.kind === "settlement"
        ? await restoreSettlementAction(groupId, removed.id)
        : await restoreExpenseAction(groupId, removed.id);
    if (!result.ok) {
      toast.error(result.error ?? t("errors.restoreFailed"));
      return;
    }
    router.refresh();
    toast.success(t("saved.restored"));
  };

  /**
   * Removing the entry outright.
   *
   * The detail screens carry a delete of their own, but this drawer can also
   * be reached without passing through one — from a notification, or from a
   * link — and offering "change it" without "remove it" would leave an entry
   * behind with no way out.
   *
   * The drawer closes on its way out, so the Undo cannot live in it. It goes
   * in the toast, which outlives the screen that raised it.
   */
  const onDelete = async () => {
    if (!editing) return;
    setPending(true);
    try {
      const result =
        editing.kind === "settlement"
          ? await deleteSettlementAction(groupId, editing.id)
          : await deleteExpenseAction(groupId, editing.id);
      if (!result.ok) {
        setError(result.error ?? t("errors.saveFailed"));
        return;
      }
      const removed = editing;
      // Close before the toast is raised. An open modal puts
      // `pointer-events: none` on the body, and the toaster hangs off the body
      // too — an Undo offered underneath one cannot be pressed.
      setConfirmDelete(false);
      toastUndoable(t("saved.deleted"), {
        label: tCommon("undo"),
        onUndo: () => onRestore(removed),
      });
      if (onRemoved) onRemoved();
      else router.refresh();
    } finally {
      setPending(false);
    }
  };

  /**
   * The entry in one plain line, for the sentence that asks about deleting it.
   *
   * Deliberately not the confirmation's line: this one has to name the entry
   * being destroyed, and "84.60 · Seb paid · split 3 ways" identifies a
   * payment rather than the thing the reader called it.
   */
  const describeEntry = (): string => {
    const parts = [description.trim() || t("labels.description")];
    if (isSettle && selectedPair) {
      parts[0] = `${selectedPair.fromName} → ${selectedPair.toName}`;
    }
    parts.push(amountFormatted);
    if (recurrence.enabled) parts.push(repeatLabel);
    return parts.join(" · ");
  };

  /**
   * The confirmation line: the two facts most likely to be wrong.
   *
   * It used to repeat the description, which the reader had just typed. Who
   * paid and how it was split are the two people actually reopen entries to
   * check, and both are cheapest to fix now — so both are named, and each is
   * a link back into the entry with the sheet that fixes it already open.
   */
  const describeSaved = (entryId: string | undefined): ReactNode => {
    const summary = savedSummary({
      type,
      amount: amountFormatted,
      payerName,
      participantCount: effectiveIncluded.length,
      settlement:
        isSettle && selectedPair
          ? {
              fromName: selectedPair.fromName,
              toName: selectedPair.toName,
              method: methodLabel,
            }
          : null,
    });

    if (summary.kind === "settled" && summary.settlement) {
      const parts = [
        summary.amount,
        t("saved.settledPair", {
          from: summary.settlement.fromName,
          to: summary.settlement.toName,
        }),
      ];
      if (summary.settlement.method !== "") {
        parts.push(summary.settlement.method);
      }
      return parts.join(" · ");
    }

    /*
     * A link only when there is somewhere to go. A queued entry has no id
     * yet, and a recurring template's first occurrence does not exist until
     * the worker makes it — in both cases the facts are still worth stating,
     * they just cannot be tapped.
     */
    const href =
      entryId && !recurrence.enabled
        ? `/groups/${groupId}/expenses/${entryId}/edit`
        : null;

    /*
     * Both facts open the same sheet, because that is where both are fixed:
     * "Paid by" and "Split between" are two sections of one roster. Two links
     * to one destination is not a redundancy — each takes the reader to their
     * own fact — but pretending they were different sheets would be.
     */
    const fact = (label: string, key: string) =>
      href ? (
        <Link
          key={key}
          href={`${href}?sheet=split`}
          className="text-primary-ink underline-offset-2 hover:underline"
        >
          {label}
        </Link>
      ) : (
        <span key={key}>{label}</span>
      );

    return (
      <>
        {summary.amount}
        {" · "}
        {fact(
          summary.payer?.received
            ? t("saved.receivedBy", { name: summary.payer.name })
            : t("saved.paidBy", { name: summary.payer?.name ?? "" }),
          "payer",
        )}
        {" · "}
        {fact(
          summary.split?.credited
            ? t("saved.creditedWays", { count: summary.split.count })
            : t("saved.splitWays", { count: summary.split?.count ?? 0 }),
          "split",
        )}
      </>
    );
  };

  const categoryGlyph = vocabulary.glyph(effectiveCategory);

  /** Today, unless a schedule has moved the first one somewhere else. */
  const dateLabel = upcoming[0]
    ? dates.plain(upcoming[0])
    : isToday(date)
      ? t("date.today")
      : dates.plain(date);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 pt-1.5 pb-3">
        <SheetTitle className="flex-1 truncate text-xl font-semibold tracking-[-0.02em]">
          {editing ? t(`editTitles.${type}`) : t(`titles.${type}`)}
        </SheetTitle>
        {/* The group's name is not repeated here: the group is on screen
            behind this, which is the whole reason it is a drawer. */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/6 text-muted-foreground transition-colors duration-150 hover:bg-foreground/12 hover:text-foreground"
          >
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">{t("close")}</span>
          </button>
        )}
      </header>

      {/* Rows overflow rather than compress: a scroll container whose
          children may shrink turns a long member list into a row of
          squashed avatars instead of a scroll. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&>*]:shrink-0">
        <EntryTypeTabs value={type} onChange={changeType} types={entryTypes} />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isSettle &&
          (namesFromGroup ? (
            <PairPicker
              members={members}
              fromId={settleFrom}
              toId={settleTo}
              onChange={(next) => {
                setSettleFrom(next.fromId);
                setSettleTo(next.toId);
              }}
            />
          ) : (
            <OutstandingList
              pairs={settlePairs}
              selectedIndex={outstandingIndex >= 0 ? outstandingIndex : null}
              onSelect={selectPair}
              onPickSomeoneElse={() => setSheet("pair")}
              hasCustomPair={customPair !== null}
            />
          ))}

        {/* Nothing to scan into an entry that already exists: the amount, the
            date and the split are all facts now, and a scan's business is
            proposing them. A file can still be attached further down. */}
        {type === "expense" && !editing && !scan && receiptScanning && (
          <ScanReceiptEntry
            enabled={receiptScanning}
            localEnabled={receiptOcrLocal}
            provider={receiptOcrProvider}
            groupId={groupId}
            participants={members.map((member) => ({
              id: member.id,
              displayName: member.displayName,
            }))}
            defaultCurrency={currency}
            onApply={applyScan}
            trigger={ScanCard}
          />
        )}

        {scan && bannerVisible && (
          <ScanBanner
            merchant={scan.description}
            itemCount={Object.keys(scan.splitValues).length}
            onDismiss={() => setBannerVisible(false)}
          />
        )}

        <AmountCard
          label={amountLabel}
          amountText={amountText}
          currency={currency}
          baseCurrency={baseCurrency}
          needsRate={needsRate}
          rate={rate}
          onRateChange={setRate}
          date={date}
          positive={isIncome}
          onAmountChange={(next) =>
            setAmountText(sanitiseAmount(next, currency))
          }
          onOpenCurrency={() => setSheet("currency")}
          locale={locale}
        />

        {/*
         * "Did I already log this?" — answered where it is asked, instead of
         * by scrolling the list later.
         *
         * Quiet on purpose: muted text, no coloured background, no icon
         * bigger than the words. Duplicates are legal — two coffee runs
         * happen — so this never blocks and never pre-empts saving. It is a
         * reassurance with one tap out of it.
         */}
        {duplicate && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-xs text-muted-foreground">
            <RotateCcw aria-hidden="true" className="size-3.5 shrink-0" />
            <span>
              {t("duplicate.note", {
                // Rounds to nothing for an entry made minutes ago, which the
                // message reads as "just now" rather than rounding it up to an
                // hour that has not passed.
                hours: Math.round(duplicate.hoursAgo),
                description: duplicate.description,
                amount: duplicate.amountFormatted,
                name: duplicate.payerName,
              })}
            </span>
            <Link
              href={`/groups/${groupId}/expenses/${duplicate.id}`}
              className="text-primary-ink underline-offset-2 hover:underline"
            >
              {t("duplicate.view")}
            </Link>
          </p>
        )}

        {/*
         * The two things somebody does with a debt: clear it, or pay some of
         * it. `Full` names the figure rather than saying "full", so you can
         * see what you are restoring after typing over it. Hidden for a named
         * pair and for a debt of nothing, both of which have no full amount
         * to offer.
         */}
        {isSettle && settleBalance !== null && settleBalance > 0n && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                setAmountText(
                  formatMinorUnits(settleBalance.toString(), currency),
                )
              }
              className="h-10 rounded-full border border-border bg-white/4 px-3 text-sm text-muted-foreground"
            >
              {t("settle.full", {
                amount: formatMinorUnits(settleBalance.toString(), currency),
              })}
            </button>
            <button
              type="button"
              onClick={() => {
                setAmountText("");
                document
                  .querySelector<HTMLInputElement>("input[data-entry-amount]")
                  ?.focus();
              }}
              className="h-10 rounded-full border border-border bg-white/4 px-3 text-sm text-muted-foreground"
            >
              {t("settle.partOfIt")}
            </button>
          </div>
        )}

        {!isSettle && (
          <RowCard>
            <Row>
              <AlignLeft
                aria-hidden="true"
                className="size-[18px] shrink-0 text-muted-foreground"
              />
              {/* Borderless on purpose: the card is already the field's
                  edge, and an input that draws its own box inside one is
                  two boxes saying the same thing. */}
              <input
                id="entry-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("labels.description")}
                aria-label={t("labels.description")}
                maxLength={200}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
            </Row>

            {/* The row reads as a breadcrumb — `Home › Household supplies` —
                and shows the category alone when there is no subcategory. It
                never shows a placeholder for the missing half: "no
                subcategory" would make an ordinary entry look unfinished.

                What the classifier filled in is marked by a bare sparkle
                rather than a pill with the word in it. A breadcrumb and a pill
                is too much for one 52px row, and the sparkle already means
                "detected" everywhere else in this screen. It is the only
                carrier of that fact now, so it is labelled. */}
            <RowButton
              icon={categoryGlyph}
              iconFilled={effectiveCategory !== ""}
              label={t("category.title")}
              value={
                vocabulary.owns(effectiveCategory) ? (
                  <>
                    {vocabulary.label(effectiveCategory)}
                    {shownSubcategory !== "" && (
                      <>
                        <span aria-hidden="true">{"  \u203a  "}</span>
                        {vocabulary.leafLabel(
                          effectiveCategory,
                          shownSubcategory,
                        )}
                      </>
                    )}
                  </>
                ) : (
                  t("category.add")
                )
              }
              muted={effectiveCategory === ""}
              tag={
                !categoryChosen && detectedCategory !== "" ? (
                  <Sparkles
                    aria-label={t("category.detected")}
                    className="size-3.5 shrink-0 text-payer-ink"
                  />
                ) : null
              }
              onClick={() => setSheet("category")}
            />
          </RowCard>
        )}

        {/* A repayment already says who paid whom and how much; what it was
            for is the one thing those three facts leave out. Optional because
            most repayments are for everything at once, and a field nobody has
            to fill in is the difference between recording that and being
            stopped to invent a title for it.

            Its own card rather than a row on the one above: there is no
            category on a repayment, so that card is a single row here and
            would read as an orphan attached to the amount. */}
        {isSettle && (
          <RowCard>
            <Row>
              <AlignLeft
                aria-hidden="true"
                className="size-[18px] shrink-0 text-muted-foreground"
              />
              <input
                id="entry-note"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("labels.descriptionOptional")}
                aria-label={t("labels.descriptionOptional")}
                // The same line the description above is, so the same limit.
                // The column holds far more for the sake of imported notes,
                // and one longer than this still opens here intact — the
                // attribute governs typing, not the value it is given.
                maxLength={200}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
            </Row>
          </RowCard>
        )}

        <RowCard>
          <Row className="relative">
            <CalendarDays
              aria-hidden="true"
              className="size-[18px] shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {dateLabel}
            </span>
            {/* The native picker, made invisible over its own label: one
                control, the platform's own calendar, and no second date
                implementation. */}
            <input
              type="date"
              // The field's name, not its value: "Aujourd'hui" is what the
              // date happens to be today, and is useless as a label
              // tomorrow.
              aria-label={t("date.label")}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              // `text-base` on an invisible field costs nothing to look at and
              // is the difference between the date picker opening and the date
              // picker opening on a sheet Safari has zoomed into: the sheet
              // sets `text-sm`, and a control that states no size inherits it.
              className="absolute inset-0 size-full text-base opacity-0"
            />
          </Row>

          {/* A settlement happened once, on a day. Nothing about it can
              recur, so the card is the date row and nothing else — and neither
              can an entry that has already happened become the template for
              future ones. */}
          {canRepeat && (
            <label
              htmlFor={repeatsId}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2"
            >
              <Repeat
                aria-hidden="true"
                className="size-[18px] shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {t("repeat.label")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {recurrence.enabled && upcomingLabel !== ""
                    ? t("repeat.next", { dates: upcomingLabel })
                    : t("repeat.schedule")}
                </span>
              </span>
              <Switch
                id={repeatsId}
                // The row is the tap target, but its subline would
                // otherwise be read out as part of the switch's name.
                aria-label={t("repeat.label")}
                checked={recurrence.enabled}
                onCheckedChange={(next) =>
                  setRecurrence((current) => ({
                    ...current,
                    enabled: next,
                  }))
                }
              />
            </label>
          )}

          {canRepeat && recurrence.enabled && (
            <RowButton
              label={t("repeat.title")}
              value={repeatLabel}
              // Aligned with the text of the rows above rather than with
              // their icons: a second repeat glyph would only say the same
              // thing twice.
              className="pl-[46px]"
              onClick={() => setSheet("recur")}
            />
          )}
        </RowCard>

        {/* The split row is always visible on an income now: it is where
            "credited to" is answered, and it used to be hidden by the mode
            that claimed to answer it instead. */}
        {!isSettle && (
          <SplitSummaryRow
            payerName={payerName}
            amountFormatted={amountFormatted}
            summary={summary}
            received={isIncome}
            onOpen={() => setSheet("split")}
          />
        )}

        {scan && !isSettle && (
          <ReceiptItems
            items={receiptRows(scan, members, currency, locale)}
            onSplitByItem={() => setSheet("split")}
          />
        )}

        {isSettle && (
          <PaymentMethodRow
            methods={countryMethods}
            value={methodId}
            customLabel={customMethod}
            country={country}
            onSelect={(id) => setMethodLabel(tMethods(id))}
            onOpenAll={() => setSheet("method")}
          />
        )}

        {isSettle && (
          <p className="text-xs text-muted-foreground">
            <SettleOutcomeLine outcome={outcome} currency={currency} />
          </p>
        )}

        {!isSettle && (
          <AttachFile
            groupId={groupId}
            files={attachments}
            onAttached={(file) =>
              setAttachments((current) => [...current, file])
            }
            onRemove={(id) =>
              setAttachments((current) =>
                current.filter((file) => file.id !== id),
              )
            }
            // A recurring template has no attachment of its own to carry,
            // so say so where the files are rather than after the entry has
            // been saved without them.
            note={recurrence.enabled ? t("attach.notRepeating") : null}
          />
        )}

        {editing && (
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                disabled={pending}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[17px] bg-card text-sm font-semibold text-destructive shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)] transition-colors active:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 aria-hidden="true" className="size-[18px] shrink-0" />
                {t("delete.trigger")}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("delete.body", { entry: describeEntry() })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>
                  {t("delete.keep")}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault();
                    void onDelete();
                  }}
                  disabled={pending}
                >
                  {t("delete.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* The end of the form, not a bar pinned over it. A footer that
            follows the reader down covers the row it is sitting on — on a
            short phone, with the keyboard up, that row is the one being
            typed into — and it promises a button that is often disabled
            anyway. Reaching it by scrolling is also the only reading of
            "done" that is true: the form has been seen to its end. Cancel
            is the scrim, the X and a downward swipe, none of which cost
            any room. */}
        <Button
          type="button"
          size="lg"
          className="h-13 w-full"
          disabled={!canSave || pending}
          onClick={onSubmit}
        >
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {t(
            `actions.${primaryActionKey(type, recurrence.enabled, editing !== undefined)}`,
          )}
        </Button>
      </div>

      <Sheet
        open={sheet !== null}
        onOpenChange={(open) => !open && setSheet(null)}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // Every one of these sheets opens on what it has to show — the
          // category chips, the currency list, who is in the split — and none
          // of them wants a keyboard over it before anybody has asked to type.
          onOpenAutoFocus={openOnContent}
          className={cn(
            "gap-0 rounded-t-[26px]",
            // The currency list is the one sheet here that is a whole screen
            // rather than a card: it fills the height it is given, scrolls its
            // own list inside a fixed header and search field, and lays out its
            // own padding. The others are as tall as they need to be and scroll
            // as one piece.
            sheet === "currency"
              ? "h-[min(800px,calc(100dvh-48px-env(safe-area-inset-top)))] max-h-[calc(100%-48px-env(safe-area-inset-top))] overflow-hidden p-0"
              : "max-h-[86vh] overflow-y-auto px-4 pt-3.5 pb-5",
          )}
        >
          {sheet === "split" && (
            <SplitSheet
              members={members}
              title={isIncome ? t("split.titleIncome") : t("split.title")}
              totalFormatted={amountFormatted}
              payerId={payerId}
              onPayerChange={setPayerId}
              includedIds={effectiveIncluded}
              onIncludedChange={(ids) => {
                setIncludedIds(ids);
                setByItem(false);
              }}
              method={method}
              onMethodChange={changeMethod}
              values={values}
              onValueChange={(id, value) =>
                setValues((current) => ({ ...current, [id]: value }))
              }
              preview={preview}
              note={splitNote}
              received={isIncome}
              splitText={splitText}
              onDone={() => setSheet(null)}
            />
          )}

          {sheet === "category" && (
            <CategorySheet
              value={effectiveCategory}
              subcategory={shownSubcategory}
              detectedValue={detectedCategory}
              description={description}
              suggestion={suggestion}
              frequent={frequentCategories}
              direction={categoryDirection}
              // Every tap in the sheet writes a valid entry, including the one
              // that only opens a pane — which is what lets the second level
              // be optional rather than a step to escape from. The sheet says
              // when it is finished; this only records what it chose.
              onSelect={(next, leaf) => {
                setCategoryChosen(true);
                setCategory(next);
                setSubcategory(leaf ?? "");
              }}
              onDone={() => setSheet(null)}
              // Reverting has to clear the override rather than re-pick the
              // detected value: a category that merely *equals* the guess is
              // still a manual choice, and would stop following the
              // description the moment it was edited again.
              onRevert={() => {
                setCategoryChosen(false);
                setCategory("");
                setSubcategory("");
                setSheet(null);
              }}
            />
          )}

          {sheet === "currency" && (
            <CurrencyPicker
              value={currency}
              title={t("currency.title")}
              // What is already typed has to survive the new currency's rules:
              // 84.60 picked up again as yen is ¥84, not an amount the server
              // will refuse.
              onSelect={(code) => {
                setCurrency(code);
                setAmountText((current) => sanitiseAmount(current, code));
                setSheet(null);
              }}
              onBack={() => setSheet(null)}
            />
          )}

          {sheet === "method" && (
            <PaymentMethodSheet
              value={methodId}
              customLabel={customMethod}
              country={country}
              suggested={countryMethods}
              onSelect={(id) => {
                setMethodLabel(tMethods(id));
                setSheet(null);
              }}
              onSelectCustom={(name) => {
                setMethodLabel(name.trim());
                setSheet(null);
              }}
            />
          )}

          {sheet === "pair" && (
            <PairSheet
              members={members}
              fromId={draftPair.fromId}
              toId={draftPair.toId}
              onChange={setDraftPair}
              onConfirm={() => {
                const pair = pairFrom(draftPair);
                if (!pair) return;
                setCustomPair(pair);
                takePair(pair);
                setSheet(null);
              }}
            />
          )}

          {sheet === "recur" && (
            <RecurrenceSheet
              state={recurrence}
              onChange={setRecurrence}
              startDate={date}
              timezone={timezone}
              onDone={() => setSheet(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * The settlement's resulting ledger, in words.
 *
 * The decision is `settleOutcome`'s; this only looks the sentence up and
 * formats the figure in it. Splitting them is what lets the seven branches be
 * tested without a renderer, and it keeps the one thing that has to stay true
 * — which sentence — out of JSX.
 */
function SettleOutcomeLine({
  outcome,
  currency,
}: {
  outcome: SettleOutcome;
  currency: string;
}) {
  const t = useTranslations("addEntry.settle");

  if (outcome.kind === "noPair") return t("outcomeNoPair");
  if (outcome.kind === "noMethod") return t("outcomeNoMethod");
  if (outcome.kind === "zeroAmount") return t("outcomeZero");
  if (outcome.kind === "exact") {
    // The only sentence with a remainder of nothing, so it names no figure.
    return t("outcomeExact", {
      from: outcome.pairNames?.fromName ?? "",
      to: outcome.pairNames?.toName ?? "",
    });
  }

  const remainder = outcome.remainder;
  if (!remainder) return null;

  const key =
    outcome.kind === "custom"
      ? "outcomeCustom"
      : outcome.kind === "under"
        ? "outcomeUnder"
        : "outcomeOver";

  return t(key, {
    from: remainder.fromName,
    to: remainder.toName,
    amount: formatMinorUnits(remainder.amountMinor.toString(), currency),
  });
}

/**
 * A stored payment method, read back as one of the picker's own.
 *
 * The column holds the label rather than the code — deliberately, so a
 * settlement still says "TWINT" years after the picker's list has moved on —
 * which means reopening one has to match it back by name. A label that matches
 * nothing is not an error: it is an import, or a provider since dropped, and
 * the form keeps it verbatim rather than picking something else.
 */
function matchPaymentMethod(
  label: string,
  translate: (id: PaymentMethodId) => string,
): PaymentMethodId | null {
  const wanted = label.trim().toLocaleLowerCase();
  if (wanted === "") return null;
  return (
    PAYMENT_METHOD_IDS.find(
      (id) => translate(id).toLocaleLowerCase() === wanted,
    ) ?? null
  );
}

function isToday(date: string): boolean {
  return date === new Date().toISOString().slice(0, 10);
}

/**
 * The receipt's own lines, as rows.
 *
 * The scanner hands back a finished split rather than the raw items, so this
 * reports what each person ended up owing — which is the fact worth checking
 * against the paper before saving.
 */
function receiptRows(
  scan: ScannedExpense,
  members: readonly EntryMember[],
  currency: string,
  locale: string,
) {
  return Object.entries(scan.splitValues).map(([participantId, value]) => {
    const member = members.find((candidate) => candidate.id === participantId);
    const parsed = parseAmountToMinor(value, currency);
    return {
      id: participantId,
      name: member?.displayName ?? participantId,
      amountFormatted: parsed.ok
        ? formatMoney(money(parsed.value, currency), { locale })
        : value,
      assignment: { kind: "person" as const, name: member?.displayName ?? "" },
    };
  });
}
