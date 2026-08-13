"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CurrencySelect } from "@/components/money/currency-select";
import { createRecurringAction } from "@/modules/recurring/actions";
import {
  parseAmountToMinor,
  previewSplit,
} from "@/components/expenses/expense-form-logic";

const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

/**
 * Creates a recurring expense template.
 *
 * Deliberately simpler than the one-off expense form: recurring bills are
 * almost always split equally, so the split here is "everyone selected, split
 * equally" and the amount is what changes. A one-off expense generated from
 * the template can still be edited afterwards.
 */
export function RecurringForm({
  groupId,
  participants,
  currencyMode,
  baseCurrency,
  defaultCurrency,
}: {
  groupId: string;
  participants: readonly { id: string; displayName: string }[];
  currencyMode: "separate" | "converted";
  baseCurrency: string | null;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [exchangeRate, setExchangeRate] = useState("");
  const [frequency, setFrequency] = useState<"weekly" | "monthly" | "yearly">(
    "monthly",
  );
  const [interval, setInterval] = useState("1");
  const [weekday, setWeekday] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [monthOfYear, setMonthOfYear] = useState("1");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [payerId, setPayerId] = useState(participants[0]?.id ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>(
    participants.map((participant) => participant.id),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const needsRate =
    currencyMode === "converted" &&
    baseCurrency !== null &&
    currency !== baseCurrency;

  const totalMinor = useMemo(
    () => parseAmountToMinor(amount, currency),
    [amount, currency],
  );

  const preview = useMemo(
    () =>
      previewSplit({
        totalMinor: totalMinor.ok ? totalMinor.value : null,
        currency,
        method: "equal",
        participantIds: selectedIds,
        values: {},
      }),
    [totalMinor, currency, selectedIds],
  );

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!totalMinor.ok) {
      setError(totalMinor.error);
      return;
    }
    if (selectedIds.length === 0) {
      setError("Choose who this is split between.");
      return;
    }
    if (needsRate && exchangeRate.trim() === "") {
      setError(`Enter the exchange rate: 1 ${currency} in ${baseCurrency}.`);
      return;
    }

    setPending(true);
    try {
      const result = await createRecurringAction(groupId, {
        description,
        amount: totalMinor.value.toString(),
        currency,
        exchangeRate: needsRate ? exchangeRate.trim() : "",
        payers: [
          { participantId: payerId, amount: totalMinor.value.toString() },
        ],
        splitMethod: "equal",
        splitEntries: selectedIds.map((id) => ({ participantId: id })),
        frequency,
        interval: Number(interval),
        weekday: frequency === "weekly" ? Number(weekday) : undefined,
        dayOfMonth: frequency !== "weekly" ? Number(dayOfMonth) : undefined,
        monthOfYear: frequency === "yearly" ? Number(monthOfYear) : undefined,
        startDate,
      });

      if (!result.ok) {
        setError(result.error ?? "The recurring expense could not be created.");
        return;
      }
      toast.success("Recurring expense set up");
      setDescription("");
      setAmount("");
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border p-4"
      noValidate
    >
      <h2 className="font-medium">Set up a recurring expense</h2>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="recurring-description">Description</Label>
        <Input
          id="recurring-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
          maxLength={200}
          placeholder="Rent"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="recurring-amount">Amount</Label>
          <Input
            id="recurring-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            placeholder="0.00"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recurring-currency">Currency</Label>
          <CurrencySelect
            id="recurring-currency"
            value={currency}
            onChange={setCurrency}
            className="sm:w-44"
          />
        </div>
      </div>

      {needsRate && (
        <div className="space-y-2">
          <Label htmlFor="recurring-rate">
            Exchange rate — 1 {currency} in {baseCurrency}
          </Label>
          <Input
            id="recurring-rate"
            inputMode="decimal"
            value={exchangeRate}
            onChange={(event) => setExchangeRate(event.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Reused for each generated occurrence.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="recurring-frequency">Repeats</Label>
          <select
            id="recurring-frequency"
            value={frequency}
            onChange={(event) =>
              setFrequency(event.target.value as typeof frequency)
            }
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="recurring-interval">Every</Label>
          <Input
            id="recurring-interval"
            type="number"
            min={1}
            max={52}
            value={interval}
            onChange={(event) => setInterval(event.target.value)}
          />
        </div>
      </div>

      {frequency === "weekly" ? (
        <div className="space-y-2">
          <Label htmlFor="recurring-weekday">On</Label>
          <select
            id="recurring-weekday"
            value={weekday}
            onChange={(event) => setWeekday(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {WEEKDAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="recurring-day">Day of month</Label>
            <Input
              id="recurring-day"
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(event) => setDayOfMonth(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Short months use their last day.
            </p>
          </div>
          {frequency === "yearly" && (
            <div className="space-y-2">
              <Label htmlFor="recurring-month">Month</Label>
              <Input
                id="recurring-month"
                type="number"
                min={1}
                max={12}
                value={monthOfYear}
                onChange={(event) => setMonthOfYear(event.target.value)}
              />
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="recurring-start">Starting</Label>
        <Input
          id="recurring-start"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="recurring-payer">Paid by</Label>
        <select
          id="recurring-payer"
          value={payerId}
          onChange={(event) => setPayerId(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {participants.map((participant) => (
            <option key={participant.id} value={participant.id}>
              {participant.displayName}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Split equally between</legend>
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
                  id={`recurring-split-${participant.id}`}
                  checked={checked}
                  onCheckedChange={() =>
                    setSelectedIds((current) =>
                      current.includes(participant.id)
                        ? current.filter((id) => id !== participant.id)
                        : [...current, participant.id],
                    )
                  }
                />
                <Label
                  htmlFor={`recurring-split-${participant.id}`}
                  className="flex-1 cursor-pointer font-normal"
                >
                  {participant.displayName}
                </Label>
                {allocation && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {allocation.formatted}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Plus aria-hidden="true" />
        )}
        Create recurring expense
      </Button>
    </form>
  );
}
