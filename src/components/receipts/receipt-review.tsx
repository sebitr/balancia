"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericField } from "./numeric-field";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CurrencySelect } from "@/components/money/currency-select";
import { formatMinorUnits } from "@/components/expenses/expense-form-logic";
import { formatMoney, money } from "@/modules/currencies/money";
import { validateReceipt, type ReceiptIssue } from "@/modules/receipts";
import {
  draftToReceipt,
  emptyItem,
  suggestedTotal,
  type DraftItem,
  type ReceiptDraft,
} from "./draft";

/**
 * The review screen.
 *
 * Every value the scanner proposed is in an input, because every one of them
 * can be wrong. Nothing here is read-only and nothing is hidden behind an
 * "advanced" disclosure: if OCR misread the total, the total is the field the
 * user needs, and it is on screen.
 *
 * Reconciliation warnings are recomputed from what is *currently in the
 * fields*, not from what OCR first said, so correcting a price makes the
 * warning about it disappear — which is the feedback that tells someone they
 * have fixed the right number.
 */
export function ReceiptReview({
  draft,
  onChange,
  imageUrl,
}: {
  draft: ReceiptDraft;
  onChange: (next: ReceiptDraft) => void;
  /** The photograph, kept on screen so values can be checked against it. */
  imageUrl?: string;
}) {
  const t = useTranslations("receiptScanner.review");
  const locale = useLocale();

  const issues = useMemo(() => validateReceipt(draftToReceipt(draft)), [draft]);

  const update = (patch: Partial<ReceiptDraft>) =>
    onChange({ ...draft, ...patch });

  const updateItem = (id: string, patch: Partial<DraftItem>) =>
    onChange({
      ...draft,
      items: draft.items.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });

  const removeItem = (id: string) =>
    onChange({ ...draft, items: draft.items.filter((item) => item.id !== id) });

  const addItem = () =>
    onChange({
      ...draft,
      items: [...draft.items, emptyItem(`added-${Date.now()}`)],
    });

  const suggestion = suggestedTotal(draft);

  /**
   * Turns a validation finding into a sentence with real amounts in it.
   *
   * Defined here rather than at module scope so `t` keeps its key types —
   * passing a next-intl translator as a parameter erases them, and a typo in a
   * message key would then only show up as missing text on screen.
   */
  const describeIssue = (issue: ReceiptIssue): string => {
    const amount = (raw: string | undefined): string => {
      if (raw === undefined) return "";
      try {
        return formatMoney(money(BigInt(raw), draft.currency), { locale });
      } catch {
        return "";
      }
    };

    return t(`issues.${issue.code}`, {
      items: amount(issue.params.items),
      subtotal: amount(issue.params.subtotal),
      parts: amount(issue.params.parts),
      total: amount(issue.params.total),
      difference: amount(issue.params.difference),
    });
  };

  return (
    <div className="space-y-6">
      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li key={issue.code}>
              <Alert
                variant={
                  issue.severity === "warning" ? "destructive" : "default"
                }
              >
                <TriangleAlert aria-hidden="true" className="size-4" />
                <AlertDescription>{describeIssue(issue)}</AlertDescription>
              </Alert>
            </li>
          ))}
        </ul>
      )}

      {imageUrl && (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            {t("showPhoto")}
          </summary>
          <div className="border-t p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local
                object URL, never a remote or optimizable source. */}
            <img
              src={imageUrl}
              alt={t("photoAlt")}
              className="mx-auto max-h-96 w-auto rounded-md"
            />
          </div>
        </details>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="receipt-merchant">{t("merchant")}</Label>
          <Input
            id="receipt-merchant"
            value={draft.merchant}
            maxLength={120}
            placeholder={t("merchantPlaceholder")}
            onChange={(event) => update({ merchant: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="receipt-date">{t("date")}</Label>
          <Input
            id="receipt-date"
            type="date"
            value={draft.date}
            onChange={(event) => update({ date: event.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="receipt-currency">{t("currency")}</Label>
        <CurrencySelect
          id="receipt-currency"
          value={draft.currency}
          onChange={(currency) => update({ currency })}
          className="sm:w-64"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("items")}</legend>

        {draft.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("noItems")}</p>
        )}

        <ul className="space-y-2">
          {draft.items.map((item, index) => (
            <li key={item.id} className="flex items-start gap-2">
              <Input
                aria-label={t("itemName", { index: index + 1 })}
                value={item.name}
                maxLength={120}
                placeholder={t("itemPlaceholder")}
                className="flex-1"
                onChange={(event) =>
                  updateItem(item.id, { name: event.target.value })
                }
              />
              <NumericField
                aria-label={t("itemQuantity", { index: index + 1 })}
                inputMode="numeric"
                value={item.quantity}
                placeholder="1"
                className="w-14"
                onValueChange={(quantity) => updateItem(item.id, { quantity })}
              />
              <NumericField
                aria-label={t("itemAmount", { index: index + 1 })}
                aria-describedby={
                  item.uncertain ? `uncertain-${item.id}` : undefined
                }
                value={item.amount}
                placeholder="0.00"
                className={`w-24 tabular-nums ${
                  item.uncertain ? "border-amber-500 dark:border-amber-400" : ""
                }`}
                onValueChange={(amount) => updateItem(item.id, { amount })}
              />
              {item.uncertain && (
                // The confidence figure itself is never shown; what the reader
                // needs is "look at this one", not "0.61".
                <span id={`uncertain-${item.id}`} className="sr-only">
                  {t("uncertain")}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeItem(item.id)}
                aria-label={t("removeItem", {
                  name: item.name || String(index + 1),
                })}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>

        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          <Plus aria-hidden="true" />
          {t("addItem")}
        </Button>
      </fieldset>

      <div className="space-y-3 rounded-lg border p-3">
        <SummaryField
          id="receipt-subtotal"
          label={t("subtotal")}
          value={draft.subtotal}
          onChange={(subtotal) => update({ subtotal })}
        />
        <SummaryField
          id="receipt-tax"
          label={t("tax")}
          value={draft.tax}
          onChange={(tax) => update({ tax })}
        />
        <SummaryField
          id="receipt-service"
          label={t("service")}
          value={draft.service}
          onChange={(service) => update({ service })}
        />
        <SummaryField
          id="receipt-tip"
          label={t("tip")}
          value={draft.tip}
          onChange={(tip) => update({ tip })}
        />
        <SummaryField
          id="receipt-total"
          label={t("total")}
          value={draft.total}
          emphasis
          onChange={(total) => update({ total })}
        />

        {draft.total.trim() === "" && suggestion !== null && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {t("totalMissing", {
                amount: formatMoney(money(suggestion, draft.currency), {
                  locale,
                }),
              })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                update({
                  total: formatMinorUnits(
                    suggestion.toString(),
                    draft.currency,
                  ),
                })
              }
            >
              {t("useSuggested")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryField({
  id,
  label,
  value,
  onChange,
  emphasis,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Label
        htmlFor={id}
        className={`flex-1 font-normal ${emphasis ? "font-medium" : ""}`}
      >
        {label}
      </Label>
      <NumericField
        id={id}
        value={value}
        placeholder="—"
        className="w-28 text-right tabular-nums"
        onValueChange={onChange}
      />
    </div>
  );
}
