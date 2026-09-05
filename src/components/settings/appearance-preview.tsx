"use client";

import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { BalanceAmount } from "@/components/money/amount";

/**
 * A corner of the app, drawn with whatever the screen below has chosen.
 *
 * Every colour here is a token: the ground is `--card`, the pill is the
 * accent, the three figures are the three balance inks, the bar is the two
 * balance fills. Nothing is passed in and nothing is stored, so the moment
 * a swatch below repaints the document root this repaints with it — the pill
 * and the button turning mint while the three figures and the bar stay
 * exactly where they were. It is what the note under the accents promises,
 * shown rather than said.
 *
 * The button is a picture of one, not a control: it has nothing to do, and a
 * focusable element that does nothing is a trap for a keyboard.
 */
export function AppearancePreview({ currency }: { currency: string }) {
  const t = useTranslations("userSettings");
  const self = t("accentPreviewSelf");

  return (
    <section
      aria-label={t("accentPreview")}
      className="flex shrink-0 flex-col gap-3 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-foreground/10"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-2xs font-semibold text-primary-ink"
          >
            {self.trim().charAt(0).toUpperCase()}
          </span>
          <span className="truncate text-sm font-medium">{self}</span>
        </span>
        <span
          aria-hidden="true"
          className={buttonVariants({ size: "sm", className: "shrink-0" })}
        >
          {t("accentPreviewAction")}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <BalanceAmount minorUnits="4250" currency={currency} size="small" />
        <BalanceAmount minorUnits="-1800" currency={currency} size="small" />
        <BalanceAmount minorUnits="0" currency={currency} size="small" />
      </div>

      <span
        aria-hidden="true"
        className="flex h-1 overflow-hidden rounded-full bg-wash-3"
      >
        <span className="w-[70%] bg-positive" />
        <span className="w-[30%] bg-negative" />
      </span>
    </section>
  );
}
