"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, QrCode } from "lucide-react";
import { needsDetail } from "@/modules/payouts/fields";
import { PaymentQr } from "./payment-qr";
import type { PaymentQrStandard } from "@/modules/payouts/qr/payment-qr";

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
  qr = null,
}: {
  name: string;
  method: string;
  detail: string;
  /** Already translated by the caller, which holds the methods catalogue. */
  methodLabel: string;
  /** Built on the server; null when no standard can carry this payment. */
  qr?: { standard: PaymentQrStandard; payload: string } | null;
}) {
  const t = useTranslations("payouts");
  const [copied, setCopied] = useState(false);
  const [showing, setShowing] = useState(false);

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
    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2">
      <div className="flex items-center gap-2">
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

      {/*
        Behind a tap rather than always open. Most rows on this screen are not
        the one being paid right now, and a settle screen that is four QR codes
        tall is one nobody reads.
      */}
      {qr && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowing((open) => !open)}
            className="flex min-h-9 items-center gap-2 self-start rounded-lg px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <QrCode aria-hidden="true" className="size-4" />
            {showing ? t("qrHide") : t("qrShow")}
          </button>

          {showing && (
            <div className="flex flex-col items-center gap-1.5 pb-1">
              <PaymentQr
                payload={qr.payload}
                standard={qr.standard}
                label={t("qrTitle")}
              />
              <span className="text-2xs text-muted-foreground">
                {qr.standard === "swiss" ? t("qrSwiss") : t("qrEpc")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
