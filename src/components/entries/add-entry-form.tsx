"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { CalendarDays, ChevronLeft, Loader2, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
import { POP } from "@/components/motion/transitions";
import { PLAIN_DATE_FORMAT, parsePlainDate } from "@/i18n/format";
import { formatMoney, money } from "@/modules/currencies/money";
import type { LearnedMerchantMapping } from "@/modules/categorization";
import type { SplitMethod } from "@/modules/expenses/split";
import {
  createExpenseAction,
  createSettlementAction,
} from "@/modules/expenses/actions";
import { createRecurringAction } from "@/modules/recurring/actions";
import {
  countryForTimezone,
  methodsForCountry,
  type PaymentMethodId,
} from "@/modules/settlements/payment-methods";
import { AmountCard } from "./amount-card";
import { AttachFile, type EntryAttachment } from "./attach-file";
import { CategoryChip, CategorySheet } from "./category-chip";
import { CurrencySheet } from "./currency-sheet";
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
import { EntrySaved } from "./entry-saved";
import { EntryTypeTabs } from "./entry-type-tabs";
import { ScanBanner, ScanCard, ReceiptItems } from "./receipt-blocks";
import { RecurrenceSheet, type RecurrenceState } from "./recurrence-sheet";
import { SplitSheet } from "./split-sheet";
import { SplitSummaryRow } from "./split-summary-row";
import {
  OutstandingList,
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
 */

type OpenSheet = null | "split" | "category" | "currency" | "method" | "recur";

const NO_MAPPINGS: readonly LearnedMerchantMapping[] = [];

export interface AddEntryFormProps {
  groupId: string;
  groupName: string;
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
  semanticCategorization?: boolean;
  receiptScanning?: boolean;
}

export function AddEntryForm({
  groupId,
  groupName,
  members,
  selfId,
  currencyMode,
  baseCurrency,
  defaultCurrency,
  timezone,
  outstanding,
  categoryMappings = NO_MAPPINGS,
  semanticCategorization = false,
  receiptScanning = false,
}: AddEntryFormProps) {
  const router = useRouter();
  const locale = useLocale();
  const format = useFormatter();
  const t = useTranslations("addEntry");
  const tSplit = useTranslations("expenses.split");
  const tCommon = useTranslations("common");

  const splitText = (message: SplitMessage) =>
    tSplit(message.key, message.params);

  const [type, setType] = useState<EntryType>("expense");
  const [amountText, setAmountText] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [rate, setRate] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [categoryChosen, setCategoryChosen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [payerId, setPayerId] = useState(selfId);
  const [includedIds, setIncludedIds] = useState<readonly string[]>(() =>
    members.map((member) => member.id),
  );
  const [method, setMethod] = useState<SplitMethod>("equal");
  const [values, setValues] = useState<Record<string, string>>({});
  /** Set once per-item assignment has written exact amounts. */
  const [byItem, setByItem] = useState(false);

  const [credit, setCredit] = useState<"shared" | "mine">("shared");

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

  const [pairIndex, setPairIndex] = useState<number | null>(
    outstanding.length > 0 ? 0 : null,
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId | null>(
    null,
  );

  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{
    key: ReturnType<typeof confirmationKey>;
    summary: string;
  } | null>(null);

  const country = countryForTimezone(timezone);
  const countryMethods = useMemo(() => methodsForCountry(country), [country]);

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
  const selectedPair =
    pairIndex !== null ? (outstanding[pairIndex] ?? null) : null;

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

  const canSave = isSettle
    ? hasAmount(amountText) && selectedPair !== null
    : hasAmount(amountText);

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
    if (next === "settle") {
      const pair = pairIndex !== null ? outstanding[pairIndex] : outstanding[0];
      if (pair) {
        setPairIndex(pairIndex ?? 0);
        setAmountText(
          formatMinorUnits(pair.amountMinor, baseCurrency ?? defaultCurrency),
        );
      }
    }
  };

  const selectPair = (index: number) => {
    setPairIndex(index);
    const pair = outstanding[index];
    if (pair) {
      setAmountText(
        formatMinorUnits(pair.amountMinor, baseCurrency ?? defaultCurrency),
      );
    }
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

  const reset = () => {
    setSaved(null);
    setError(null);
    setDescription("");
    setCategory("");
    setCategoryChosen(false);
    setMethod("equal");
    setValues({});
    setByItem(false);
    setIncludedIds(members.map((member) => member.id));
    setScan(null);
    setBannerVisible(false);
    setAttachments([]);
    setRecurrence((current) => ({ ...current, enabled: false }));
    // In settle the amount is re-seeded from the pair rather than zeroed:
    // the debt is still there, and blanking it just means retyping it.
    if (isSettle && selectedPair) {
      setAmountText(
        formatMinorUnits(
          selectedPair.amountMinor,
          baseCurrency ?? defaultCurrency,
        ),
      );
    } else {
      setAmountText("");
    }
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
      setSaved({
        key: confirmationKey(type, recurrence.enabled),
        summary: describeSaved(),
      });
      router.refresh();
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

  const submitEntry = () =>
    createExpenseAction(groupId, {
      direction: directionOf(type) ?? "out",
      description: description.trim(),
      notes: "",
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

  const submitSettlement = () =>
    createSettlementAction(groupId, {
      fromParticipantId: selectedPair!.fromParticipantId,
      toParticipantId: selectedPair!.toParticipantId,
      amount: totalMinor.ok ? totalMinor.value.toString() : "0",
      currency,
      exchangeRate: needsRate ? rate.trim() : "",
      settledOn: date,
      paymentMethod: resolvedMethodLabel(),
      notes: "",
    });

  const tMethods = useTranslations("paymentMethods");
  /**
   * What gets stored: the method's *label*, not its code.
   *
   * The column is free text on purpose — a settlement should still say "TWINT"
   * years later even if the picker's list has moved on.
   */
  const resolvedMethodLabel = () => {
    const id = paymentMethod ?? countryMethods[0];
    return id ? tMethods(id) : "";
  };

  /** One line for the confirmation screen: what was saved, and how much. */
  const describeSaved = (): string => {
    const amount = amountFormatted;
    if (isSettle && selectedPair) {
      return `${selectedPair.fromName} → ${selectedPair.toName} · ${amount}`;
    }
    const parts = [description.trim() || t("labels.description"), amount];
    if (recurrence.enabled) {
      parts.push(
        t("repeat.active", {
          frequency: t(`repeat.frequency.${recurrence.frequency}`),
          day:
            recurrence.frequency === "weekly"
              ? String(recurrence.weekday)
              : t("repeat.dayOfMonth", { day: recurrence.dayOfMonth }),
        }),
      );
    }
    return parts.join(" · ");
  };

  if (saved) {
    return (
      <EntrySaved
        titleKey={saved.key}
        summary={saved.summary}
        onAddAnother={reset}
        onBackToGroup={() => router.push(`/groups/${groupId}`)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[18px] pb-4">
      <Link
        href={`/groups/${groupId}`}
        // Going back up to the group is a pop, and should animate like one —
        // the rest of the app moves this way since the motion work landed.
        transitionTypes={POP}
        className="-ml-1 inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground"
      >
        <ChevronLeft aria-hidden="true" className="size-[18px]" />
        {groupName}
      </Link>

      <EntryTypeTabs value={type} onChange={changeType} />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isSettle && (
        <OutstandingList
          pairs={outstanding}
          selectedIndex={pairIndex}
          onSelect={selectPair}
        />
      )}

      {type === "expense" && !scan && receiptScanning && (
        <ScanReceiptEntry
          enabled={receiptScanning}
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
        currencyLocked={isSettle}
        onAmountChange={(next) => setAmountText(sanitiseAmount(next, currency))}
        onOpenCurrency={() => setSheet("currency")}
        locale={locale}
      />

      {!isSettle && (
        <div className="space-y-2">
          <label
            htmlFor="entry-description"
            className="text-sm font-medium text-muted-foreground"
          >
            {t("labels.description")}
          </label>
          <Input
            id="entry-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("labels.descriptionPlaceholder")}
            maxLength={200}
            className="h-12"
          />
          <CategoryChip
            value={effectiveCategory}
            detected={!categoryChosen && detectedCategory !== ""}
            onOpen={() => setSheet("category")}
          />
        </div>
      )}

      {isIncome && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-muted-foreground">
            {t("income.belongsTo")}
          </legend>
          <CreditOption
            selected={credit === "shared"}
            onSelect={() => setCredit("shared")}
            title={t("income.shared")}
            hint={t("income.sharedHint", {
              count: members.length,
              amount: eachFormatted ?? amountFormatted,
            })}
          />
          <CreditOption
            selected={credit === "mine"}
            onSelect={() => setCredit("mine")}
            title={t("income.mine", { name: payerName })}
            hint={t("income.mineHint")}
          />
        </fieldset>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute inset-0 flex items-center gap-2 rounded-xl border border-border px-3 text-sm">
            <CalendarDays
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            {isToday(date)
              ? t("date.today")
              : format.dateTime(parsePlainDate(date), PLAIN_DATE_FORMAT)}
          </span>
          {/* The native picker, made invisible over its own label: one control,
              the platform's own calendar, and no second date implementation. */}
          <input
            type="date"
            // The field's name, not its value: "Aujourd'hui" is what the date
            // happens to be today, and is useless as a label tomorrow.
            aria-label={t("date.label")}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-11 w-full opacity-0"
          />
        </div>

        {!isSettle && (
          <button
            type="button"
            onClick={() => {
              setRecurrence((current) => ({ ...current, enabled: true }));
              setSheet("recur");
            }}
            className={cn(
              "flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border text-sm transition-colors",
              recurrence.enabled
                ? "border-primary bg-primary/10 font-semibold"
                : "border-border font-medium",
            )}
          >
            <Repeat aria-hidden="true" className="size-4" />
            {recurrence.enabled
              ? t("repeat.active", {
                  frequency: t(`repeat.frequency.${recurrence.frequency}`),
                  day:
                    recurrence.frequency === "weekly"
                      ? String(recurrence.weekday)
                      : t("repeat.dayOfMonth", { day: recurrence.dayOfMonth }),
                })
              : t("repeat.oneOff")}
          </button>
        )}
      </div>

      {isSettle ? (
        <PaymentMethodRow
          methods={countryMethods}
          value={paymentMethod}
          country={country}
          onSelect={setPaymentMethod}
          onOpenAll={() => setSheet("method")}
        />
      ) : (
        !(isIncome && credit === "mine") && (
          <SplitSummaryRow
            payerName={payerName}
            amountFormatted={amountFormatted}
            summary={summary}
            received={isIncome}
            onOpen={() => setSheet("split")}
          />
        )
      )}

      {scan && !isSettle && (
        <ReceiptItems
          items={receiptRows(scan, members, currency, locale)}
          onSplitByItem={() => setSheet("split")}
        />
      )}

      {isSettle && selectedPair && (
        <p className="text-[13px] text-muted-foreground">
          {paymentMethod || countryMethods[0]
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
          onAttached={(file) => setAttachments((current) => [...current, file])}
          onRemove={(id) =>
            setAttachments((current) =>
              current.filter((file) => file.id !== id),
            )
          }
          // A recurring template has no attachment of its own to carry, so say
          // so where the files are rather than after the entry has been saved
          // without them.
          note={recurrence.enabled ? t("attach.notRepeating") : null}
        />
      )}

      <div className="flex gap-3">
        <Button
          type="button"
          size="lg"
          className="h-13 flex-1"
          disabled={!canSave || pending}
          onClick={onSubmit}
        >
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {t(`actions.${primaryActionKey(type, recurrence.enabled)}`)}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-13 w-[92px]"
          onClick={() => router.back()}
          disabled={pending}
        >
          {tCommon("cancel")}
        </Button>
      </div>

      <Sheet
        open={sheet !== null}
        onOpenChange={(open) => !open && setSheet(null)}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[86vh] gap-0 overflow-y-auto rounded-t-[26px] px-4 pt-3.5 pb-5"
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
              received={isIncome}
              splitText={splitText}
              onDone={() => setSheet(null)}
            />
          )}

          {sheet === "category" && (
            <CategorySheet
              value={effectiveCategory}
              detectedValue={detectedCategory}
              onSelect={(next) => {
                setCategoryChosen(true);
                setCategory(next);
              }}
              onDone={() => setSheet(null)}
            />
          )}

          {sheet === "currency" && (
            <CurrencySheet
              value={currency}
              baseCurrency={baseCurrency}
              // What is already typed has to survive the new currency's rules:
              // 84.60 picked up again as yen is ¥84, not an amount the server
              // will refuse.
              onSelect={(code) => {
                setCurrency(code);
                setAmountText((current) => sanitiseAmount(current, code));
              }}
              onDone={() => setSheet(null)}
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
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-3 rounded-[14px] border p-3.5 text-left transition-colors",
        selected ? "border-positive bg-positive/10" : "border-border bg-card",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0 rounded-full border-2",
          selected ? "border-positive bg-positive" : "border-white/30",
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-[13px] text-muted-foreground">{hint}</span>
      </span>
    </button>
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
