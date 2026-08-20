"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useDateFormatter, useNumberLocale } from "@/i18n/format-context";
import {
  AlignLeft,
  CalendarDays,
  Loader2,
  Repeat,
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
import { ScanReceiptEntry } from "@/components/receipts/scan-receipt-entry";
import type { ScannedExpense } from "@/components/receipts/scan-receipt-dialog";
import {
  CATEGORY_GLYPHS,
  FALLBACK_GLYPH,
  hasGlyph,
} from "@/components/expenses/category-icon";
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
import type {
  ExpenseCategory,
  LearnedMerchantMapping,
} from "@/modules/categorization";
import type { SplitMethod } from "@/modules/expenses/split";
import {
  convertExpenseToSettlementAction,
  convertSettlementToExpenseAction,
  createExpenseAction,
  createSettlementAction,
  deleteExpenseAction,
  deleteSettlementAction,
  updateExpenseAction,
  updateSettlementAction,
} from "@/modules/expenses/actions";
import { createRecurringAction } from "@/modules/recurring/actions";
import {
  PAYMENT_METHOD_IDS,
  countryForTimezone,
  methodsForCountry,
  type PaymentMethodId,
} from "@/modules/settlements/payment-methods";
import { AmountCard } from "./amount-card";
import { AttachFile, type EntryAttachment } from "./attach-file";
import { CategorySheet } from "./category-sheet";
import { CurrencyPicker } from "@/components/money/currency-picker";
import {
  confirmationKey,
  directionOf,
  hasAmount,
  primaryActionKey,
  resetsForType,
  sanitiseAmount,
  summariseSplit,
  type EntryType,
} from "./entry-logic";
import { EntryTypeTabs } from "./entry-type-tabs";
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
  PaymentMethodRow,
  PaymentMethodSheet,
  type DebtPair,
} from "./settle-blocks";
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

type OpenSheet = null | "split" | "category" | "currency" | "method" | "recur";

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

const NO_MAPPINGS: readonly LearnedMerchantMapping[] = [];
/** A group with no history yet — the picker simply has nothing to lead with. */
const NO_FREQUENT: readonly ExpenseCategory[] = [];

export interface AddEntryFormProps {
  groupId: string;
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
  categoryMappings?: readonly LearnedMerchantMapping[];
  /** What this group files things under, most used first, for the picker. */
  frequentCategories?: readonly ExpenseCategory[];
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
   */
  onRemoved?: () => void;
}

export function AddEntryForm({
  groupId,
  members,
  selfId,
  currencyMode,
  baseCurrency,
  defaultCurrency,
  timezone,
  outstanding,
  categoryMappings = NO_MAPPINGS,
  frequentCategories = NO_FREQUENT,
  semanticCategorization = false,
  receiptScanning = false,
  receiptOcrLocal = true,
  receiptOcrProvider,
  editing,
  onClose,
  onSaved,
  onRemoved,
}: AddEntryFormProps) {
  const router = useRouter();
  const locale = useNumberLocale();
  const dates = useDateFormatter();
  const t = useTranslations("addEntry");
  const tSplit = useTranslations("expenses.split");
  const tCategories = useTranslations("expenses.categories");
  const tMethods = useTranslations("paymentMethods");
  const repeatsId = useId();

  const splitText = (message: SplitMessage) =>
    tSplit(message.key, message.params);

  /**
   * Income the reader kept, reopened.
   *
   * Stored as a share of one, which is also what an expense split with a
   * single person looks like — the difference is the direction, and it is what
   * tells the two apart when the entry comes back.
   */
  const creditsOnePerson =
    editing?.type === "income" &&
    editing.includedIds.length === 1 &&
    editing.includedIds[0] === editing.payerId;

  const [type, setType] = useState<EntryType>(editing?.type ?? "expense");
  const [amountText, setAmountText] = useState(editing?.amountText ?? "");
  const [currency, setCurrency] = useState(
    editing?.currency ?? defaultCurrency,
  );
  const [rate, setRate] = useState(editing?.exchangeRate ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  /**
   * What a repayment was for — the column has always called it notes.
   *
   * Kept apart from `description` rather than folded into it, because an
   * expense carries notes of its own that this screen never shows. Sharing one
   * value would let a tab switch overwrite an imported note with a title, and
   * the reader would never see it happen.
   */
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  // A category already on the entry is a decision somebody made, whoever made
  // it. Leaving it open to the classifier would let reopening an entry
  // silently refile it the moment the description was touched.
  const [categoryChosen, setCategoryChosen] = useState(
    (editing?.category ?? "") !== "",
  );
  const [date, setDate] = useState(
    () => editing?.date ?? new Date().toISOString().slice(0, 10),
  );

  const [payerId, setPayerId] = useState(editing?.payerId ?? selfId);
  // A settlement has no split of its own, and income credited to one person
  // has one only in the sense that nobody else is in it. Both seed the full
  // membership, so a reader who switches to something that does split starts
  // where a new entry would rather than with a single name selected.
  const [includedIds, setIncludedIds] = useState<readonly string[]>(() =>
    editing && !creditsOnePerson && editing.includedIds.length > 0
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

  const [credit, setCredit] = useState<"shared" | "mine">(
    creditsOnePerson ? "mine" : "shared",
  );

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
    () => editing?.payerId ?? null,
  );
  const [settleTo, setSettleTo] = useState<string | null>(
    () => editing?.settleTo ?? null,
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId | null>(
    () => matchPaymentMethod(editing?.paymentMethod ?? "", tMethods),
  );

  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const country = countryForTimezone(timezone);
  const countryMethods = useMemo(() => methodsForCountry(country), [country]);
  /** A stored method the picker cannot name. Empty once anything is picked. */
  const unmatchedMethod =
    paymentMethod === null &&
    editing !== undefined &&
    matchPaymentMethod(editing.paymentMethod, tMethods) === null
      ? editing.paymentMethod
      : "";

  const suggestion = useCategorySuggestion({
    description,
    notes: "",
    mappings: categoryMappings,
    semanticEnabled: semanticCategorization,
  });
  const detectedCategory =
    !categoryChosen && suggestion?.decision === "auto_assigned"
      ? (suggestion.category ?? "")
      : "";
  const effectiveCategory = categoryChosen ? category : detectedCategory;

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

  /** Which outstanding row, if any, the current pair happens to be. */
  const outstandingIndex = outstanding.findIndex(
    (pair) =>
      pair.fromParticipantId === settleFrom &&
      pair.toParticipantId === settleTo,
  );

  const needsRate =
    currencyMode === "converted" &&
    baseCurrency !== null &&
    currency !== baseCurrency;

  const totalMinor = parseAmountToMinor(amountText || "0", currency);

  /** "Mine only" income covers one person, so nobody else's balance moves. */
  const effectiveIncluded = useMemo(
    () => (isIncome && credit === "mine" ? [payerId] : includedIds),
    [isIncome, credit, payerId, includedIds],
  );

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
    const resets = resetsForType(next);
    setType(next);
    setError(null);
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
    setAmountText(formatMinorUnits(pair.amountMinor, pair.currency));
  };

  const selectPair = (index: number) => {
    const pair = outstanding[index];
    if (pair) takePair(pair);
  };

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
      const result = isSettle
        ? await submitSettlement()
        : recurrence.enabled
          ? await submitRecurring()
          : await submitEntry();

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
        { description: describeSaved() },
      );
      // A conversion removed the row this drawer was opened on, so it leaves
      // the way a deletion does rather than back onto a detail screen that no
      // longer has anything to show.
      const leave = converting ? onRemoved : onSaved;
      if (leave) leave();
      else router.refresh();
    } finally {
      setPending(false);
    }
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

  const submitEntry = () => {
    const input = expensePayload();
    if (!editing) return createExpenseAction(groupId, input);
    return converting
      ? convertSettlementToExpenseAction(groupId, editing.id, input)
      : updateExpenseAction(groupId, editing.id, input);
  };

  const expensePayload = () => ({
    direction: directionOf(type) ?? "out",
    description: description.trim(),
    notes,
    category: effectiveCategory,
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

  const submitRecurring = () =>
    createRecurringAction(groupId, {
      direction: directionOf(type) ?? "out",
      description: description.trim(),
      notes: "",
      category: effectiveCategory,
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
    });

  const submitSettlement = () => {
    const input = {
      fromParticipantId: selectedPair!.fromParticipantId,
      toParticipantId: selectedPair!.toParticipantId,
      amount: totalMinor.ok ? totalMinor.value.toString() : "0",
      currency,
      exchangeRate: needsRate ? rate.trim() : "",
      settledOn: date,
      paymentMethod: resolvedMethodLabel(),
      notes,
    };
    if (!editing) return createSettlementAction(groupId, input);
    return converting
      ? convertExpenseToSettlementAction(groupId, editing.id, input)
      : updateSettlementAction(groupId, editing.id, input);
  };

  /**
   * What gets stored: the method's *label*, not its code.
   *
   * The column is free text on purpose — a settlement should still say "TWINT"
   * years later even if the picker's list has moved on.
   */
  const resolvedMethodLabel = () => {
    if (paymentMethod) return tMethods(paymentMethod);
    // A label the picker no longer lists — an import, or a provider that has
    // since left the list — is still the truth about how the money moved, so
    // an untouched form writes it back rather than dropping it.
    if (unmatchedMethod !== "") return unmatchedMethod;
    // Nothing chosen means nothing to say. Falling back to this country's
    // first method wrote a payment method nobody had picked onto every
    // repayment, and the column is optional precisely because "I paid them
    // back" is a complete answer.
    return "";
  };

  /**
   * Removing the entry outright.
   *
   * It lives here rather than on a detail screen because this is now the only
   * screen an entry is opened on — a settlement never had a detail screen at
   * all, and offering "change it" without "remove it" would leave one behind
   * with no way out.
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
      toast.success(t("saved.deleted"));
      if (onRemoved) onRemoved();
      else router.refresh();
    } finally {
      setPending(false);
    }
  };

  /** One line for the confirmation screen: what was saved, and how much. */
  const describeSaved = (): string => {
    const amount = amountFormatted;
    if (isSettle && selectedPair) {
      return `${selectedPair.fromName} → ${selectedPair.toName} · ${amount}`;
    }
    const parts = [description.trim() || t("labels.description"), amount];
    if (recurrence.enabled) parts.push(repeatLabel);
    return parts.join(" · ");
  };

  const categoryGlyph = hasGlyph(effectiveCategory)
    ? CATEGORY_GLYPHS[effectiveCategory]
    : FALLBACK_GLYPH;

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
        <EntryTypeTabs value={type} onChange={changeType} />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isSettle &&
          (editing ? (
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
              pairs={outstanding}
              selectedIndex={outstandingIndex >= 0 ? outstandingIndex : null}
              onSelect={selectPair}
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

            <RowButton
              icon={categoryGlyph}
              label={t("category.title")}
              value={
                hasGlyph(effectiveCategory)
                  ? tCategories(effectiveCategory)
                  : t("category.add")
              }
              muted={effectiveCategory === ""}
              tag={
                !categoryChosen && detectedCategory !== "" ? (
                  <span className="shrink-0 rounded-full bg-payer/15 px-2 py-0.5 text-2xs font-semibold text-payer">
                    {t("category.detectedTag")}
                  </span>
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

        {isIncome && (
          <RowCard role="radiogroup" aria-label={t("income.belongsTo")}>
            <CreditOption
              selected={credit === "shared"}
              onSelect={() => setCredit("shared")}
              title={t("income.shared")}
              hint={t("income.sharedHint", {
                count: effectiveIncluded.length,
                amount: eachFormatted ?? amountFormatted,
              })}
            />
            <CreditOption
              selected={credit === "mine"}
              onSelect={() => setCredit("mine")}
              title={t("income.mine", { name: payerName })}
              hint={t("income.mineHint")}
            />
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

        {!isSettle && !(isIncome && credit === "mine") && (
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
            value={paymentMethod}
            country={country}
            onSelect={setPaymentMethod}
            onOpenAll={() => setSheet("method")}
          />
        )}

        {isSettle && selectedPair && (
          <p className="text-xs text-muted-foreground">
            {resolvedMethodLabel() !== ""
              ? t("settle.outcome", {
                  from: selectedPair.fromName,
                  to: selectedPair.toName,
                  amount: amountFormatted,
                  method: resolvedMethodLabel(),
                })
              : t("settle.outcomeNoMethod", {
                  from: selectedPair.fromName,
                  to: selectedPair.toName,
                  amount: amountFormatted,
                })}
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
          <AlertDialog>
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
                  {t("delete.body", { entry: describeSaved() })}
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
              detectedValue={detectedCategory}
              description={description}
              suggestion={suggestion}
              frequent={frequentCategories}
              onSelect={(next) => {
                setCategoryChosen(true);
                setCategory(next);
                setSheet(null);
              }}
              // Reverting has to clear the override rather than re-pick the
              // detected value: a category that merely *equals* the guess is
              // still a manual choice, and would stop following the
              // description the moment it was edited again.
              onRevert={() => {
                setCategoryChosen(false);
                setCategory("");
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
              value={paymentMethod}
              country={country}
              suggested={countryMethods}
              onSelect={(id) => {
                setPaymentMethod(id);
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
 * One of the two ways income can land, as a row in the card.
 *
 * A radio rather than a switch or a pair of chips: the two are exclusive, one
 * is always true, and each needs a line of explanation underneath — which is
 * what a radio row is for.
 */
function CreditOption({
  selected,
  onSelect,
  title,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-accent"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-[18px] shrink-0 rounded-full border",
          selected ? "border-primary bg-primary" : "border-input",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  );
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
