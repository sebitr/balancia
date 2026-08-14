"use client";

import { useTranslations } from "next-intl";
import { Camera, ScanLine, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CaptureActions } from "@/components/receipts/scan-receipt-entry";

/**
 * The receipt, before and after it has been read.
 *
 * Scanning is offered at the *top* of the form rather than as an afterthought
 * at the bottom, because a scan fills in the amount, the date, the merchant
 * and the split — everything below it. Offering it last invites someone to
 * type all of that first and then find out they needn't have.
 *
 * Once a scan has run the card is replaced by a banner, so the entry point
 * cannot be pressed again on top of values it already produced.
 *
 * Camera and Upload are two buttons that do two things, and each opens its own
 * picker on the spot. They used to be painted labels on one big button that
 * opened a dialog asking the same question a second time — so choosing
 * "Camera" cost two taps and told you nothing the first tap had not. The card
 * is the scanner's `trigger` component, and takes the two pickers as its props.
 */

export function ScanCard({ camera, upload }: CaptureActions) {
  const t = useTranslations("addEntry.scan");

  return (
    <div className="w-full space-y-3 rounded-[17px] bg-card p-4 text-left shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
          <ScanLine aria-hidden="true" className="size-5 text-primary" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{t("title")}</span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {t("subtitle")}
          </span>
        </span>
      </div>

      <div className="flex gap-2">
        {/* Only where there is a camera to open. A fine pointer means a desktop,
            and a desktop's "camera" is a picker that finds no camera. */}
        <button
          type="button"
          onClick={camera}
          className="hidden h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-opacity active:opacity-80 pointer-coarse:flex"
        >
          <Camera aria-hidden="true" className="size-4" />
          {t("camera")}
        </button>
        {/* Which leaves Upload as the only action there, so it takes the
            primary weight — and gives it back once Camera is alongside it. */}
        <button
          type="button"
          onClick={upload}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors active:opacity-80 pointer-coarse:border pointer-coarse:border-border pointer-coarse:bg-transparent pointer-coarse:font-medium pointer-coarse:text-foreground"
        >
          <Upload aria-hidden="true" className="size-4" />
          {t("upload")}
        </button>
      </div>
    </div>
  );
}

export function ScanBanner({
  merchant,
  itemCount,
  onDismiss,
}: {
  merchant: string;
  itemCount: number;
  onDismiss: () => void;
}) {
  const t = useTranslations("addEntry.scan");

  return (
    <div className="flex items-start gap-3 rounded-[17px] border border-positive/35 bg-positive/12 p-3.5">
      {/* A drawn stand-in for the receipt; the real image is optional and is
          only kept when the scanner was told to keep it. */}
      <span
        aria-hidden="true"
        className="flex h-14 w-11 shrink-0 flex-col justify-center gap-1 rounded-[4px] bg-white px-1.5"
      >
        {[7, 5, 6, 4].map((width, index) => (
          <span
            key={index}
            className="block h-[2px] rounded-full bg-black/25"
            style={{ width: `${width * 10}%` }}
          />
        ))}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">
          {t("read", { count: itemCount, merchant })}
        </span>
        <span className="block text-[13px] text-muted-foreground">
          {t("check")}
        </span>
      </span>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("dismiss")}
        className="-m-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors active:bg-white/10"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

export interface ReceiptItemRow {
  readonly id: string;
  readonly name: string;
  readonly amountFormatted: string;
  /** Who it went to: everyone, one person by name, or nobody yet. */
  readonly assignment:
    | { kind: "everyone"; count: number }
    | { kind: "person"; name: string }
    | { kind: "withBill" }
    | { kind: "unassigned" };
}

export function ReceiptItems({
  items,
  onSplitByItem,
}: {
  items: readonly ReceiptItemRow[];
  onSplitByItem: () => void;
}) {
  const t = useTranslations("addEntry.scan");

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {t("itemsTitle")}
        </h2>
        <button
          type="button"
          onClick={onSplitByItem}
          className="inline-flex h-7 items-center rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground"
        >
          {t("splitByItem")}
        </button>
      </div>

      <ul className="overflow-hidden rounded-[17px] bg-card shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
        {items.map((item) => {
          // A row that went somewhere other than the default is tinted, so the
          // exceptions are findable without reading every line.
          const custom = item.assignment.kind === "person";
          const missing = item.assignment.kind === "unassigned";
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-3 border-b border-white/8 px-3.5 py-2.5 last:border-b-0",
                custom && "bg-primary/8",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {item.name}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                  missing
                    ? "text-negative"
                    : custom
                      ? "bg-primary/20 font-semibold text-foreground"
                      : "bg-white/8 text-muted-foreground",
                )}
              >
                {item.assignment.kind === "everyone" &&
                  t("tagEveryone", { count: item.assignment.count })}
                {item.assignment.kind === "person" && item.assignment.name}
                {item.assignment.kind === "withBill" && t("tagWithBill")}
                {item.assignment.kind === "unassigned" && t("tagUnassigned")}
              </span>
              <span className="w-16 shrink-0 text-right text-sm tabular-nums">
                {item.amountFormatted}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
