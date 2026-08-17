"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useNumberLocale } from "@/i18n/format-context";
import { Loader2, Paperclip, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CurrencyField } from "@/components/money/currency-field";
import { ExchangeRateField } from "@/components/money/exchange-rate-field";
import { ReceiptUploader } from "@/components/expenses/receipt-uploader";
import {
  ScanReceiptEntry,
  type ScannedExpense,
} from "@/components/receipts/scan-receipt-entry";
import { CategoryField } from "@/components/expenses/category-field";
import { useCategorySuggestion } from "@/components/expenses/use-category-suggestion";
import {
  createExpenseAction,
  updateExpenseAction,
} from "@/modules/expenses/actions";
import type { LearnedMerchantMapping } from "@/modules/categorization";
import type { EntryDirection } from "@/modules/expenses/direction";
import {
  formatMinorUnits,
  parseAmountToMinor,
  previewSplit,
  type SplitMessage,
  type SplitPreview,
} from "./expense-form-logic";
import type { SplitMethod } from "@/modules/expenses/split";

/**
 * Add / edit expense.
 *
 * The component owns interaction only. Every calculation — parsing amounts,
 * validating a split, previewing allocations — goes through
 * `expense-form-logic`, which is pure and unit-tested, and the authoritative
 * split is recomputed server-side by the domain service regardless of what
 * this form shows.
 */

export interface ExpenseFormParticipant {
  readonly id: string;
  readonly displayName: string;
}

export interface ExpenseFormInitialValues {
  readonly id: string;
  /**
   * Carried through untouched.
   *
   * This form only edits spending, but it must not *change* what it was
   * handed: saving without this would rewrite an income as an expense and move
   * every balance by twice the amount.
   */
  readonly direction: EntryDirection;
  readonly description: string;
  readonly notes: string;
  readonly category: string;
  readonly amount: string;
  readonly currency: string;
  readonly exchangeRate: string;
  readonly expenseDate: string;
  readonly splitMethod: SplitMethod;
  readonly payers: readonly { participantId: string; amount: string }[];
  readonly splitEntries: readonly { participantId: string; value?: string }[];
}

/**
 * Stable identity for the default, so the classification memo and its effect
 * are not invalidated on every render of a form that was given no mappings.
 */
const NO_MAPPINGS: readonly LearnedMerchantMapping[] = [];

/** Tab order is fixed; the label and hint are looked up per locale. */
const SPLIT_TABS: readonly SplitMethod[] = [
  "equal",
  "exact",
  "percentage",
  "shares",
];

export function ExpenseForm({
  groupId,
  participants,
  currencyMode,
  baseCurrency,
  defaultCurrency,
  initial,
  categoryMappings = NO_MAPPINGS,
  semanticCategorization = false,
  receiptScanning = false,
  receiptOcrLocal = true,
  receiptOcrProvider,
}: {
  groupId: string;
  participants: readonly ExpenseFormParticipant[];
  currencyMode: "separate" | "converted";
  baseCurrency: string | null;
  defaultCurrency: string;
  initial?: ExpenseFormInitialValues;
  /** What this group and user have already taught the classifier. */
  categoryMappings?: readonly LearnedMerchantMapping[];
  /** Whether the operator installed the optional embedding model. */
  semanticCategorization?: boolean;
  /** Whether the operator installed the optional OCR models. */
  receiptScanning?: boolean;
  /** Whether the on-device reader is switched on (`RECEIPT_OCR_LOCAL`). */
  receiptOcrLocal?: boolean;
  /** The configured server-side reader, named. Never a key. */
  receiptOcrProvider?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);
  const locale = useNumberLocale();
  const t = useTranslations("expenses.form");
  const tSplit = useTranslations("expenses.split");
  const tCommon = useTranslations("common");

  /** Renders a failure reported by the pure split logic. */
  const splitText = (message: SplitMessage) =>
    tSplit(message.key, message.params);

  const [description, setDescription] = useState(initial?.description ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  /**
   * Once someone picks a category themselves, the classifier stops filling
   * the field — including on an expense that already had one when it opened.
   */
  const [categoryChosen, setCategoryChosen] = useState(
    Boolean(initial?.category),
  );
  const [amountText, setAmountText] = useState(initial?.amount ?? "");
  const [currency, setCurrency] = useState(
    initial?.currency ?? defaultCurrency,
  );
  const [exchangeRate, setExchangeRate] = useState(initial?.exchangeRate ?? "");
  const [expenseDate, setExpenseDate] = useState(
    initial?.expenseDate ?? new Date().toISOString().slice(0, 10),
  );
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(
    initial?.splitMethod ?? "equal",
  );

  const [payerIds, setPayerIds] = useState<string[]>(
    initial?.payers.map((payer) => payer.participantId) ??
      (participants[0] ? [participants[0].id] : []),
  );
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (initial?.payers ?? []).map((payer) => [
        payer.participantId,
        formatMinorUnits(payer.amount, initial?.currency ?? defaultCurrency),
      ]),
    ),
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(
    initial?.splitEntries.map((entry) => entry.participantId) ??
      participants.map((participant) => participant.id),
  );
  const [splitValues, setSplitValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (initial?.splitEntries ?? [])
        .filter((entry) => entry.value !== undefined)
        .map((entry) => [
          entry.participantId,
          initial?.splitMethod === "exact"
            ? formatMinorUnits(
                entry.value as string,
                initial?.currency ?? defaultCurrency,
              )
            : (entry.value as string),
        ]),
    ),
  );

  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const suggestion = useCategorySuggestion({
    description,
    notes,
    mappings: categoryMappings,
    semanticEnabled: semanticCategorization,
  });

  // Derived rather than stored: an auto-detected category is a *view* of the
  // current description, so editing the description re-decides it, and one
  // manual choice takes the field over for good.
  const detectedCategory =
    !categoryChosen && suggestion?.decision === "auto_assigned"
      ? (suggestion.category ?? "")
      : "";
  const effectiveCategory = categoryChosen ? category : detectedCategory;

  const needsExchangeRate =
    currencyMode === "converted" &&
    baseCurrency !== null &&
    currency !== baseCurrency;

  const totalMinor = useMemo(
    () => parseAmountToMinor(amountText, currency),
    [amountText, currency],
  );

  const preview: SplitPreview = useMemo(
    () =>
      previewSplit({
        totalMinor: totalMinor.ok ? totalMinor.value : null,
        currency,
        method: splitMethod,
        participantIds: selectedIds,
        values: splitValues,
        locale,
      }),
    [totalMinor, currency, splitMethod, selectedIds, splitValues, locale],
  );

  const payerTotal = useMemo(() => {
    let sum = 0n;
    for (const id of payerIds) {
      const parsed = parseAmountToMinor(
        payerIds.length === 1 ? amountText : (payerAmounts[id] ?? ""),
        currency,
      );
      if (!parsed.ok) return null;
      sum += parsed.value;
    }
    return sum;
  }, [payerIds, payerAmounts, amountText, currency]);

  const payersBalance =
    totalMinor.ok && payerTotal !== null && payerTotal === totalMinor.value;

  const toggleSelected = (participantId: string) => {
    setSelectedIds((current) =>
      current.includes(participantId)
        ? current.filter((id) => id !== participantId)
        : [...current, participantId],
    );
  };

  const togglePayer = (participantId: string) => {
    setPayerIds((current) =>
      current.includes(participantId)
        ? current.filter((id) => id !== participantId)
        : [...current, participantId],
    );
  };

  /**
   * Fills the form in from a scanned receipt.
   *
   * The scanner produces values for fields that already exist, and the split
   * it produces is an ordinary **exact** split — so from here on a scanned
   * expense is indistinguishable from a typed one, and the server recomputes
   * the same allocations either way.
   *
   * A merchant the scanner could not read leaves the description alone rather
   * than blanking whatever was already typed.
   */
  const applyScan = (scan: ScannedExpense) => {
    if (scan.description !== "") setDescription(scan.description);
    setAmountText(scan.amount);
    setCurrency(scan.currency);
    setExpenseDate(scan.date);
    setSplitMethod("exact");
    setSelectedIds([...scan.participantIds]);
    setSplitValues(scan.splitValues);
    if (scan.attachmentId) {
      setAttachmentIds((current) => [...current, scan.attachmentId!]);
    }
    // Paid-by is left untouched: the receipt says what was bought, never who
    // put the card in the machine.
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!totalMinor.ok) {
      setError(splitText(totalMinor.error));
      return;
    }
    if (payerIds.length === 0) {
      setError(t("errors.choosePayer"));
      return;
    }
    if (selectedIds.length === 0) {
      setError(t("errors.chooseSplit"));
      return;
    }
    if (!payersBalance) {
      setError(t("errors.payersMustBalance"));
      return;
    }
    if (!preview.ok) {
      setError(preview.error ? splitText(preview.error) : null);
      return;
    }
    if (needsExchangeRate && exchangeRate.trim() === "") {
      setError(
        t("errors.enterRate", { from: currency, to: baseCurrency ?? "" }),
      );
      return;
    }

    const payers = payerIds.map((id) => {
      if (payerIds.length === 1) {
        return { participantId: id, amount: totalMinor.value.toString() };
      }
      const parsed = parseAmountToMinor(payerAmounts[id] ?? "", currency);
      return {
        participantId: id,
        amount: parsed.ok ? parsed.value.toString() : "0",
      };
    });

    const splitEntries = selectedIds.map((id) => {
      if (splitMethod === "equal") return { participantId: id };
      if (splitMethod === "exact") {
        const parsed = parseAmountToMinor(splitValues[id] ?? "", currency);
        return {
          participantId: id,
          value: parsed.ok ? parsed.value.toString() : "0",
        };
      }
      return { participantId: id, value: (splitValues[id] ?? "0").trim() };
    });

    const payload = {
      direction: initial?.direction ?? "out",
      description,
      notes,
      category: effectiveCategory,
      amount: totalMinor.value.toString(),
      currency,
      exchangeRate: needsExchangeRate ? exchangeRate.trim() : "",
      expenseDate,
      payers,
      splitMethod,
      splitEntries,
      attachmentIds,
    };

    setPending(true);
    try {
      const result = isEdit
        ? await updateExpenseAction(groupId, initial!.id, payload)
        : await createExpenseAction(groupId, payload);

      if (!result.ok) {
        setError(result.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(isEdit ? t("updated") : t("added"));
      router.push(`/groups/${groupId}/expenses`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const activeHint = t(`hints.${splitMethod}`);

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!isEdit && (
        // Offered on a new expense only: re-scanning an expense that already
        // exists would overwrite a split somebody may have adjusted by hand.
        <ScanReceiptEntry
          enabled={receiptScanning}
          localEnabled={receiptOcrLocal}
          provider={receiptOcrProvider}
          groupId={groupId}
          participants={participants}
          defaultCurrency={defaultCurrency}
          onApply={applyScan}
        />
      )}

      <div className="space-y-2">
        <Label htmlFor="description">{t("description")}</Label>
        <Input
          id="description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
          maxLength={200}
          placeholder={t("descriptionPlaceholder")}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="amount">{t("amount")}</Label>
          <Input
            id="amount"
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            required
            placeholder="0.00"
            aria-describedby={
              !totalMinor.ok && amountText ? "amount-error" : undefined
            }
            aria-invalid={Boolean(amountText) && !totalMinor.ok}
          />
          {amountText && !totalMinor.ok && (
            <p id="amount-error" className="text-sm text-destructive">
              {splitText(totalMinor.error)}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">{t("currency")}</Label>
          <CurrencyField
            id="currency"
            value={currency}
            onChange={setCurrency}
            label={t("currency")}
            className="sm:w-56"
          />
        </div>
      </div>

      {needsExchangeRate && (
        <ExchangeRateField
          id="exchangeRate"
          from={currency}
          to={baseCurrency!}
          on={expenseDate}
          value={exchangeRate}
          onChange={setExchangeRate}
          hint={t("exchangeRateHint")}
        />
      )}

      <div className="space-y-2">
        <Label htmlFor="expenseDate">{t("date")}</Label>
        <Input
          id="expenseDate"
          type="date"
          value={expenseDate}
          onChange={(event) => setExpenseDate(event.target.value)}
          required
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("paidBy")}</legend>
        <ul className="divide-y rounded-lg border">
          {participants.map((participant) => {
            const checked = payerIds.includes(participant.id);
            return (
              <li key={participant.id} className="flex items-center gap-3 p-3">
                <Checkbox
                  id={`payer-${participant.id}`}
                  checked={checked}
                  onCheckedChange={() => togglePayer(participant.id)}
                />
                <Label
                  htmlFor={`payer-${participant.id}`}
                  className="flex-1 cursor-pointer font-normal"
                >
                  {participant.displayName}
                </Label>
                {checked && payerIds.length > 1 && (
                  <Input
                    aria-label={t("amountPaidBy", {
                      name: participant.displayName,
                    })}
                    inputMode="decimal"
                    className="w-28"
                    placeholder="0.00"
                    value={payerAmounts[participant.id] ?? ""}
                    onChange={(event) =>
                      setPayerAmounts((current) => ({
                        ...current,
                        [participant.id]: event.target.value,
                      }))
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
        {payerIds.length > 1 && totalMinor.ok && !payersBalance && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <TriangleAlert aria-hidden="true" className="size-4" />
            {t("payersMustAddUp")}
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("split")}</legend>
        <Tabs
          value={splitMethod}
          onValueChange={(value) => setSplitMethod(value as SplitMethod)}
        >
          <TabsList className="grid w-full grid-cols-4">
            {SPLIT_TABS.map((method) => (
              <TabsTrigger key={method} value={method}>
                {t(`tabs.${method}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">{activeHint}</p>

        <ul className="divide-y rounded-lg border">
          {participants.map((participant) => {
            const checked = selectedIds.includes(participant.id);
            const allocation = preview.ok
              ? preview.allocations.find(
                  (entry) => entry.participantId === participant.id,
                )
              : undefined;

            return (
              <li key={participant.id} className="flex items-center gap-3 p-3">
                <Checkbox
                  id={`split-${participant.id}`}
                  checked={checked}
                  onCheckedChange={() => toggleSelected(participant.id)}
                />
                <Label
                  htmlFor={`split-${participant.id}`}
                  className="flex-1 cursor-pointer font-normal"
                >
                  {participant.displayName}
                </Label>

                {checked && splitMethod !== "equal" && (
                  <Input
                    aria-label={
                      splitMethod === "percentage"
                        ? t("percentageFor", {
                            name: participant.displayName,
                          })
                        : splitMethod === "shares"
                          ? t("sharesFor", { name: participant.displayName })
                          : t("amountFor", { name: participant.displayName })
                    }
                    inputMode="decimal"
                    className="w-24"
                    placeholder={splitMethod === "shares" ? "1" : "0"}
                    value={splitValues[participant.id] ?? ""}
                    onChange={(event) =>
                      setSplitValues((current) => ({
                        ...current,
                        [participant.id]: event.target.value,
                      }))
                    }
                  />
                )}

                {checked && allocation && (
                  <span className="w-24 text-right text-sm text-muted-foreground tabular-nums">
                    {allocation.formatted}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {!preview.ok && preview.error && selectedIds.length > 0 && (
          <p className="text-sm text-destructive">{splitText(preview.error)}</p>
        )}

        {preview.ok && preview.roundingNote && (
          <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            {splitText(preview.roundingNote)}
          </p>
        )}
      </fieldset>

      <CategoryField
        value={effectiveCategory}
        onChange={(value) => {
          setCategoryChosen(true);
          setCategory(value);
        }}
        suggestion={suggestion}
        detected={detectedCategory !== ""}
      />

      <div className="space-y-2">
        <Label htmlFor="notes">
          {t("notes")}{" "}
          <span className="font-normal text-muted-foreground">
            ({tCommon("optional")})
          </span>
        </Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={2000}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Paperclip aria-hidden="true" className="size-4" />
          {t("receipts")}
        </Label>
        <ReceiptUploader
          groupId={groupId}
          onUploaded={(id) => setAttachmentIds((current) => [...current, id])}
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" className="flex-1" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {isEdit ? t("saveChanges") : t("addExpense")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={pending}
        >
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );
}

export function RemoveButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("common");
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onClick}>
      <Trash2 aria-hidden="true" />
      <span className="sr-only">{t("remove")}</span>
    </Button>
  );
}
