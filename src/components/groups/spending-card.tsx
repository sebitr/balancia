"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Amount } from "@/components/money/amount";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PUSH } from "@/components/motion/transitions";
import type { SpendingPeriodKey } from "@/modules/groups/overview";

export interface SpendingPeriodView {
  readonly key: SpendingPeriodKey;
  readonly stats: readonly {
    readonly currency: string;
    readonly groupSpent: string;
    readonly youPaid: string;
    readonly yourShare: string;
  }[];
}

/**
 * Quiet context at the bottom of the overview, never the page's headline.
 *
 * One line per currency, which is the whole reason this card fits underneath a
 * four-currency group: it used to repeat a full stat block — total, share,
 * paid, bar, two captions — once per currency, so the least important card on
 * the screen was also the tallest.
 *
 * The bars are deliberately not comparable to each other. Each is scaled
 * inside its own currency, because the only honest thing to say across two
 * currencies is nothing; that is what the caption under them is for, and why
 * there is no shared axis and no cross-currency total.
 */
export function SpendingCard({
  groupId,
  periods,
}: {
  groupId: string;
  periods: readonly SpendingPeriodView[];
}) {
  const t = useTranslations("group");
  const [periodKey, setPeriodKey] = useState<SpendingPeriodKey>("thisMonth");
  const period =
    periods.find((candidate) => candidate.key === periodKey) ?? periods[0];

  if (!period) return null;

  return (
    <section aria-labelledby="spending" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="spending" className="text-sm font-medium">
          {t("spending")}
        </h2>

        {/* The period moves this card and nothing else on the screen: the
            balances above are what is outstanding now, which no window of
            time can narrow. */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-[30px] items-center gap-1 rounded-md border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none">
            {t(`spendingPeriods.${periodKey}`)}
            <ChevronDown
              aria-hidden="true"
              className="size-[13px] opacity-50"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuRadioGroup
              value={periodKey}
              onValueChange={(value) =>
                setPeriodKey(value as SpendingPeriodKey)
              }
            >
              {periods.map((candidate) => (
                <DropdownMenuRadioItem
                  key={candidate.key}
                  value={candidate.key}
                  className="min-h-10 px-2.5"
                >
                  {t(`spendingPeriods.${candidate.key}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
        <div className="flex flex-col gap-3 px-4 py-3.5">
          {period.stats.map((stat) => (
            <CurrencySpending key={stat.currency} stat={stat} />
          ))}

          <p className="text-2xs text-pretty text-muted-foreground">
            {t("shareBarCaption")}
          </p>
        </div>

        <Link
          href={`/groups/${groupId}/stats`}
          transitionTypes={PUSH}
          className="flex min-h-11 items-center gap-2.5 border-t bg-muted/50 px-4 py-3 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
        >
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {t("statistics")}
            <span className="font-normal text-muted-foreground">
              {" · "}
              {t("statisticsCaption")}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-[15px] shrink-0 text-muted-foreground"
          />
        </Link>
      </div>
    </section>
  );
}

function CurrencySpending({
  stat,
}: {
  stat: SpendingPeriodView["stats"][number];
}) {
  const t = useTranslations("group");
  const total = BigInt(stat.groupSpent);
  const share = BigInt(stat.yourShare);
  const rawPercent =
    total > 0n ? Number((share * 100n + total / 2n) / total) : 0;
  const percent = Math.max(0, Math.min(100, rawPercent));

  return (
    <div className="flex items-center gap-2.5">
      <span className="min-w-[34px] shrink-0 text-2xs font-semibold tracking-[0.05em] text-muted-foreground">
        {stat.currency}
      </span>

      <span
        role="img"
        aria-label={t("shareBarLabel", { percent })}
        className="h-[5px] flex-1 overflow-hidden rounded-full bg-muted"
      >
        <span
          className="block h-full rounded-full bg-primary transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </span>

      {/* No currency code: the row already names it, once, on the left. */}
      <Amount
        minorUnits={stat.groupSpent}
        currency={stat.currency}
        display="none"
        className="min-w-[62px] shrink-0 text-right text-xs font-semibold"
      />
    </div>
  );
}
