"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { needsDetail } from "@/modules/payouts/fields";

/**
 * How the person you owe wants it, shown where you are about to pay them.
 *
 * One method, not a menu: the owner ranked their own list and the top one is
 * their answer. Nothing here is fetched by name — the row only exists because
 * the balances say this reader owes this person, which is the whole of the
 * permission (see `listPayoutsOwed`).
 *
 * The detail is copyable because the alternative is transcribing an IBAN by
 * hand from one app into another, which is exactly where the digit goes wrong.
 */
export function PayoutHint({
  name,
  method,
  detail,
  methodLabel,
}: {
  name: string;
  method: string;
  detail: string;
  /** Already translated by the caller, which holds the methods catalogue. */
  methodLabel: string;
}) {
  const t = useTranslations("payouts");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard leaves the text on screen to be
      // selected by hand, which is what it was before there was a button.
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-2xs text-muted-foreground">
          {t("settle.title", { name })}
        </span>
        <span className="truncate text-sm font-medium">
          {methodLabel}
          {needsDetail(method) && detail ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {detail}
            </span>
          ) : null}
        </span>
      </div>

      {needsDetail(method) && detail ? (
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? t("copied") : t("copy")}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-4 text-positive" />
          ) : (
            <Copy aria-hidden="true" className="size-4" />
          )}
          {/* The icon changes for the eye; this is the same news for a
              screen reader, which cannot see it change. */}
          <span aria-live="polite" className="sr-only">
            {copied ? t("copied") : ""}
          </span>
        </button>
      ) : null}
    </div>
  );
}
