"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The exchange-rate input, shared by the expense, settlement and recurring
 * forms.
 *
 * It asks /api/rates for a suggestion and fills the field with it, but the
 * field stays an ordinary text input: the moment someone types their own rate,
 * the suggestion stops overwriting it and becomes an offer they can take back.
 * When no suggestion is available — provider switched off, currency the
 * provider does not publish, provider down — the component says nothing extra
 * and the rate is simply typed, exactly as before there was a provider.
 */

interface Suggestion {
  readonly rate: string;
  readonly quotedOn: string;
  readonly provider: string;
}

export function ExchangeRateField({
  id,
  from,
  to,
  on,
  value,
  onChange,
  hint,
}: {
  id: string;
  /** Currency the amount is in. */
  from: string;
  /** Group base currency. */
  to: string;
  /** Day the rate applies to, `YYYY-MM-DD`. */
  on: string;
  value: string;
  onChange: (rate: string) => void;
  hint: React.ReactNode;
}) {
  const t = useTranslations("exchangeRate");
  const dates = useDateFormatter();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [loading, setLoading] = useState(true);

  // Changing currency or date invalidates the suggestion on screen before the
  // new one arrives; adjusting state during render is React's own answer to
  // "reset when a prop changes", and avoids a frame showing the wrong day.
  const lookupKey = `${from}|${to}|${on}`;
  const [lastLookupKey, setLastLookupKey] = useState(lookupKey);
  if (lookupKey !== lastLookupKey) {
    setLastLookupKey(lookupKey);
    setSuggestion(null);
    setLoading(true);
  }

  // An existing rate — editing an expense — counts as the user's own from the
  // start, so re-opening a form never silently reprices it.
  const editedRef = useRef(value.trim() !== "");
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!from || !to || from === to || !on) return;

    const controller = new AbortController();
    const query = new URLSearchParams({ from, to, on });
    fetch(`/api/rates?${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: Suggestion | { rate: null } | null) => {
        if (!payload || typeof payload.rate !== "string") {
          setSuggestion(null);
          return;
        }
        const quote = payload as Suggestion;
        setSuggestion(quote);
        if (!editedRef.current) onChangeRef.current(quote.rate);
      })
      .catch(() => {
        // Including aborts: a superseded lookup has nothing to report.
        setSuggestion(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [from, to, on]);

  const usingSuggestion =
    suggestion !== null && value.trim() === suggestion.rate;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("label", { from, to })}</Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => {
          editedRef.current = true;
          onChange(event.target.value);
        }}
        placeholder="1.0854"
        required
      />

      {loading && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          {t("looking", {
            date: dates.plain(on),
          })}
        </p>
      )}

      {!loading && suggestion && usingSuggestion && (
        <p className="text-xs text-muted-foreground">
          {t("suggested", {
            provider: suggestion.provider,
            date: dates.plain(suggestion.quotedOn),
          })}
        </p>
      )}

      {!loading && suggestion && !usingSuggestion && (
        <p className="text-xs text-muted-foreground">
          {t("quotes", {
            provider: suggestion.provider,
            rate: suggestion.rate,
            date: dates.plain(suggestion.quotedOn),
          })}{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => onChange(suggestion.rate)}
          >
            {t("useThat")}
          </button>
        </p>
      )}

      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
