"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { ExchangeRateField } from "@/components/money/exchange-rate-field";
import { createSettlementAction } from "@/modules/expenses/actions";
import {
  formatMinorUnits,
  parseAmountToMinor,
} from "@/components/expenses/expense-form-logic";

/**
 * Records a repayment between two participants.
 *
 * Opened either empty from the page header, or filled in from a suggested
 * transfer. In the second case every field is still editable: people pay round
 * numbers and pay in parts, and a dialog that only accepts the exact suggested
 * figure gets abandoned the first time somebody hands over €150 for a €148.60
 * debt.
 *
 * The prefilled values are read once, as initial state. Callers that need the
 * dialog to reflect a different suggestion mount a separate instance with a
 * `key` rather than relying on props to sync — which keeps a half-typed amount
 * from being overwritten underneath the person typing it.
 */
export function SettleUpDialog({
  groupId,
  participants,
  currencyMode,
  baseCurrency,
  defaultCurrency,
  initialFromId,
  initialToId,
  initialAmountMinor,
  initialCurrency,
  trigger,
}: {
  groupId: string;
  participants: readonly { id: string; displayName: string }[];
  currencyMode: "separate" | "converted";
  baseCurrency: string | null;
  defaultCurrency: string;
  initialFromId?: string;
  initialToId?: string;
  /** Minor units, as a string — formatted for the field on first render. */
  initialAmountMinor?: string;
  initialCurrency?: string;
  /** Replaces the default "Settle up" button. */
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations("settlement");
  const tSplit = useTranslations("expenses.split");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState(
    initialFromId ?? participants[0]?.id ?? "",
  );
  const [toId, setToId] = useState(initialToId ?? participants[1]?.id ?? "");
  const [amount, setAmount] = useState(() =>
    initialAmountMinor
      ? formatMinorUnits(initialAmountMinor, initialCurrency ?? defaultCurrency)
      : "",
  );
  const [currency, setCurrency] = useState(initialCurrency ?? defaultCurrency);
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
      setError(tSplit(parsed.error.key, parsed.error.params));
      return;
    }
    if (fromId === toId) {
      setError(t("errors.samePerson"));
      return;
    }
    if (needsRate && exchangeRate.trim() === "") {
      setError(
        t("errors.enterRate", { from: currency, to: baseCurrency ?? "" }),
      );
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
        setError(result.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(t("recorded"));
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
        {trigger ?? (
          <Button size="sm">
            <ArrowRightLeft aria-hidden="true" />
            {t("settleUp")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="settle-from">{t("whoPaid")}</Label>
            <select
              id="settle-from"
              value={fromId}
              onChange={(event) => setFromId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
            >
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settle-to">{t("whoReceived")}</Label>
            <select
              id="settle-to"
              value={toId}
              onChange={(event) => setToId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
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
              <Label htmlFor="settle-amount">{t("amount")}</Label>
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
              <Label htmlFor="settle-currency">{t("currency")}</Label>
              <CurrencySelect
                id="settle-currency"
                value={currency}
                onChange={setCurrency}
                className="sm:w-44"
              />
            </div>
          </div>

          {needsRate && (
            <ExchangeRateField
              id="settle-rate"
              from={currency}
              to={baseCurrency!}
              on={settledOn}
              value={exchangeRate}
              onChange={setExchangeRate}
              hint={t("rateHint")}
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="settle-date">{t("date")}</Label>
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
              {t("notes")}{" "}
              <span className="font-normal text-muted-foreground">
                ({tCommon("optional")})
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
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
