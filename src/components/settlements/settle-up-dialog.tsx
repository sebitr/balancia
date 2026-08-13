"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CurrencySelect } from "@/components/money/currency-select";
import { createSettlementAction } from "@/modules/expenses/actions";
import { parseAmountToMinor } from "@/components/expenses/expense-form-logic";

/** Records a repayment between two participants. */
export function SettleUpDialog({
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
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState(participants[0]?.id ?? "");
  const [toId, setToId] = useState(participants[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [exchangeRate, setExchangeRate] = useState("");
  const [settledOn, setSettledOn] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const needsRate =
    currencyMode === "converted" &&
    baseCurrency !== null &&
    currency !== baseCurrency;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const parsed = parseAmountToMinor(amount, currency);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (fromId === toId) {
      setError("Choose two different people.");
      return;
    }
    if (needsRate && exchangeRate.trim() === "") {
      setError(`Enter the exchange rate: 1 ${currency} in ${baseCurrency}.`);
      return;
    }

    setPending(true);
    try {
      const result = await createSettlementAction(groupId, {
        fromParticipantId: fromId,
        toParticipantId: toId,
        amount: parsed.value.toString(),
        currency,
        exchangeRate: needsRate ? exchangeRate.trim() : "",
        settledOn,
        notes,
      });
      if (!result.ok) {
        setError(result.error ?? "The payment could not be recorded.");
        return;
      }
      toast.success("Payment recorded");
      setOpen(false);
      setAmount("");
      setNotes("");
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  if (participants.length < 2) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <ArrowRightLeft aria-hidden="true" />
          Settle up
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            A payment moves balances between two people. It is not counted as
            group spending.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="settle-from">Who paid</Label>
            <select
              id="settle-from"
              value={fromId}
              onChange={(event) => setFromId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settle-to">Who received it</Label>
            <select
              id="settle-to"
              value={toId}
              onChange={(event) => setToId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="settle-amount">Amount</Label>
              <Input
                id="settle-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settle-currency">Currency</Label>
              <CurrencySelect
                id="settle-currency"
                value={currency}
                onChange={setCurrency}
                className="sm:w-44"
              />
            </div>
          </div>

          {needsRate && (
            <div className="space-y-2">
              <Label htmlFor="settle-rate">
                Exchange rate — 1 {currency} in {baseCurrency}
              </Label>
              <Input
                id="settle-rate"
                inputMode="decimal"
                value={exchangeRate}
                onChange={(event) => setExchangeRate(event.target.value)}
                placeholder="1.0854"
                required
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="settle-date">Date</Label>
            <Input
              id="settle-date"
              type="date"
              value={settledOn}
              onChange={(event) => setSettledOn(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="settle-notes">
              Notes{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="settle-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              maxLength={2000}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending} className="w-full">
              {pending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
