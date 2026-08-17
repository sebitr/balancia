"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { BarChart3, ChevronDown, ChevronRight } from "lucide-react";
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

/** Quiet context at the bottom of the overview, never the page's headline. */
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

        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-[30px] items-center gap-1 rounded-full border px-2.5 text-[0.75rem] font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {t(`spendingPeriods.${periodKey}`)}
            <ChevronDown aria-hidden="true" className="size-3.5" />
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

      <div className="overflow-hidden rounded-2xl ring-1 ring-border">
        <div className="flex flex-col divide-y">
          {period.stats.map((stat) => (
            <CurrencySpending key={stat.currency} stat={stat} />
          ))}
        </div>

        <Link
          href={`/groups/${groupId}/expenses`}
          transitionTypes={PUSH}
          className="flex min-h-12 items-center gap-2.5 border-t px-4 transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <BarChart3
            aria-hidden="true"
            className="size-[17px] shrink-0 text-primary"
          />
          <span className="min-w-0 flex-1 text-[0.8125rem] font-medium">
            {t("statistics")}
            <span className="font-normal text-muted-foreground">
              {" · "}
              {t("statisticsCaption")}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
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
    <div className="px-4 pt-4 pb-3.5">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.71875rem] text-muted-foreground">
            {t("groupSpending")}
          </p>
          <Amount
            minorUnits={stat.groupSpent}
            currency={stat.currency}
            display="code"
            className="mt-0.5 block truncate text-[1.375rem] font-semibold tracking-[-0.02em]"
          />
        </div>
        <span className="shrink-0 pb-0.5 text-[0.71875rem] text-muted-foreground tabular-nums">
          {t("percentYours", { percent })}
        </span>
      </div>

      <div
        role="img"
        aria-label={t("shareBarLabel", { percent })}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"
      >
        <span
          className="block h-full rounded-full bg-primary/70 transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 divide-x">
        <div className="pr-3">
          <dt className="flex items-center gap-1.5 text-[0.71875rem] text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-[7px] rounded-full bg-primary/70"
            />
            {t("statYourShare")}
          </dt>
          <dd className="mt-0.5 truncate text-[0.90625rem] font-semibold">
            <Amount
              minorUnits={stat.yourShare}
              currency={stat.currency}
              display="code"
            />
          </dd>
        </div>
        <div className="pl-3">
          <dt className="flex items-center gap-1.5 text-[0.71875rem] text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-[7px] rounded-full bg-positive/70"
            />
            {t("statYouPaid")}
          </dt>
          <dd className="mt-0.5 truncate text-[0.90625rem] font-semibold">
            <Amount
              minorUnits={stat.youPaid}
              currency={stat.currency}
              display="code"
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}
