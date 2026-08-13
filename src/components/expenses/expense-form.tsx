"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CurrencySelect } from "@/components/money/currency-select";
import { ExchangeRateField } from "@/components/money/exchange-rate-field";
import { ReceiptUploader } from "@/components/expenses/receipt-uploader";
import {
  createExpenseAction,
  updateExpenseAction,
} from "@/modules/expenses/actions";
import {
  formatMinorUnits,
  parseAmountToMinor,
  previewSplit,
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

const SPLIT_TABS: { value: SplitMethod; label: string; hint: string }[] = [
  {
    value: "equal",
    label: "Equally",
    hint: "Split evenly between everyone selected.",
  },
  { value: "exact", label: "Exact", hint: "Enter each person's exact amount." },
  {
    value: "percentage",
    label: "Percent",
    hint: "Percentages must add up to 100.",
  },
  {
    value: "shares",
    label: "Shares",
    hint: "Weights, e.g. 2 shares versus 1.",
  },
];

export function ExpenseForm({
  groupId,
  participants,
  currencyMode,
  baseCurrency,
  defaultCurrency,
  initial,
}: {
  groupId: string;
  participants: readonly ExpenseFormParticipant[];
  currencyMode: "separate" | "converted";
  baseCurrency: string | null;
  defaultCurrency: string;
  initial?: ExpenseFormInitialValues;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);

  const [description, setDescription] = useState(initial?.description ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
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
      }),
    [totalMinor, currency, splitMethod, selectedIds, splitValues],
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

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!totalMinor.ok) {
      setError(totalMinor.error);
      return;
    }
    if (payerIds.length === 0) {
      setError("Choose who paid.");
      return;
    }
    if (selectedIds.length === 0) {
      setError("Choose who this expense is split between.");
      return;
    }
    if (!payersBalance) {
      setError("What the payers put in must add up to the expense total.");
      return;
    }
    if (!preview.ok) {
      setError(preview.error);
      return;
    }
    if (needsExchangeRate && exchangeRate.trim() === "") {
      setError(`Enter the exchange rate: 1 ${currency} in ${baseCurrency}.`);
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
      description,
      notes,
      category,
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
        setError(result.error ?? "The expense could not be saved.");
        return;
      }
      toast.success(isEdit ? "Expense updated" : "Expense added");
      router.push(`/groups/${groupId}/expenses`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const activeHint = SPLIT_TABS.find((tab) => tab.value === splitMethod)?.hint;

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
          maxLength={200}
          placeholder="Dinner at the harbour"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="amount">Amount</Label>
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
              {totalMinor.error}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <CurrencySelect
            id="currency"
            value={currency}
            onChange={setCurrency}
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
          hint="This rate is frozen with the expense. Changing rates later never rewrites what is already recorded."
        />
      )}

      <div className="space-y-2">
        <Label htmlFor="expenseDate">Date</Label>
        <Input
          id="expenseDate"
          type="date"
          value={expenseDate}
          onChange={(event) => setExpenseDate(event.target.value)}
          required
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Paid by</legend>
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
                    aria-label={`Amount paid by ${participant.displayName}`}
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
            The payers&apos; amounts must add up to the expense total.
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Split</legend>
        <Tabs
          value={splitMethod}
          onValueChange={(value) => setSplitMethod(value as SplitMethod)}
        >
          <TabsList className="grid w-full grid-cols-4">
            {SPLIT_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
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
                        ? `Percentage for ${participant.displayName}`
                        : splitMethod === "shares"
                          ? `Shares for ${participant.displayName}`
                          : `Amount for ${participant.displayName}`
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
          <p className="text-sm text-destructive">{preview.error}</p>
        )}

        {preview.ok && preview.roundingNote && (
          <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            {preview.roundingNote}
          </p>
        )}
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="category">
          Category{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          maxLength={60}
          placeholder="Food"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
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
          Receipts
        </Label>
        <ReceiptUploader
          groupId={groupId}
          onUploaded={(id) => setAttachmentIds((current) => [...current, id])}
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" className="flex-1" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {isEdit ? "Save changes" : "Add expense"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onClick}>
      <Trash2 aria-hidden="true" />
      <span className="sr-only">Remove</span>
    </Button>
  );
}
