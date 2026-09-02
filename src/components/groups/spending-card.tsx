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
import { cn } from "@/lib/utils";
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
 * The narrowest window that still has something to say.
 *
 * `spendingPeriodsOf` hands the periods over widest-last — this month, last
 * month, since the last settlement, all time — so the first one carrying a
 * figure is also the tightest one that does.
 *
 * Opening on "this month" unconditionally is what this replaces, and it read
 * badly in exactly the groups the app is best at. A trip that ended in August,
 * opened on the first of September, showed a group total of 0.00, a share of
 * 0.00, an "0% yours" and an empty bar — four zeros directly under balances
 * saying the group still owed 3,261.70. Nothing was broken; the card was
 * answering a question about a month nobody had spent anything in yet.
 *
 * A group with no entries at all has nothing to escalate to, and keeps this
 * month: an empty card is the honest answer there.
 */
function widestSpokenPeriod(
  periods: readonly SpendingPeriodView[],
): SpendingPeriodKey {
  const spoken = periods.find((period) =>
    period.stats.some((stat) => BigInt(stat.groupSpent) !== 0n),
  );
  return spoken?.key ?? periods[0]?.key ?? "thisMonth";
}

/**
 * Quiet context at the bottom of the overview, never the page's headline.
 *
 * Two shapes, because one currency and four are not the same problem. With one
 * currency there is room to say everything — the total, the reader's share,
 * what they paid — and no reason not to. With four, that block repeated four
 * times made the least important card on the screen the tallest, so each
 * currency collapses to a line: code, bar, total.
 *
 * The compact bars are deliberately not comparable to each other. Each is
 * scaled inside its own currency, because the only honest thing to say across
 * two currencies is nothing; that is what the caption under them is for, and
 * why there is no shared axis and no cross-currency total.
 *
 * Which shape is the caller's call, and it is the group's currency count
 * rather than the period's: a period switch that flipped the card's whole
 * layout would be a redesign performed by a dropdown.
 */
export function SpendingCard({
  groupId,
  periods,
  compact,
}: {
  groupId: string;
  periods: readonly SpendingPeriodView[];
  /** One line per currency instead of a stat block each. */
  compact: boolean;
}) {
  const t = useTranslations("group");
  const [periodKey, setPeriodKey] = useState<SpendingPeriodKey>(() =>
    widestSpokenPeriod(periods),
  );
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
          <DropdownMenuTrigger
            className={cn(
              "tap-target flex h-[30px] items-center gap-1 border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
              compact ? "rounded-md" : "rounded-full",
            )}
          >
            {t(`spendingPeriods.${periodKey}`)}
            <ChevronDown
              aria-hidden="true"
              className={cn(compact ? "size-[13px] opacity-50" : "size-3.5")}
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
        {compact ? (
          <div className="flex flex-col gap-3 px-4 py-3.5">
            {period.stats.map((stat) => (
              <CurrencySpending key={stat.currency} stat={stat} />
            ))}

            <p className="text-2xs text-pretty text-muted-foreground">
              {t("shareBarCaption")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y">
            {period.stats.map((stat) => (
              <CurrencySpendingBlock key={stat.currency} stat={stat} />
            ))}
          </div>
        )}

        <Link
          href={`/groups/${groupId}/stats`}
          transitionTypes={PUSH}
          // The caption sits under the title rather than after a middot, and
          // two stacked lines run together into one accessible name with
          // nothing between them. The separator the eye reads as a line break
          // has to be spelled out for anything listening.
          aria-label={`${t("statistics")} · ${t("statisticsCaption")}`}
          className={cn(
            "flex items-center gap-2.5 border-t px-4 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
            compact ? "min-h-11 bg-muted/50 py-2.5" : "min-h-12 py-2.5",
          )}
        >
          {!compact && (
            <BarChart3
              aria-hidden="true"
              className="size-[17px] shrink-0 text-primary-ink"
            />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium">
              {t("statistics")}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {t("statisticsCaption")}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "shrink-0 text-muted-foreground",
              compact ? "size-[15px]" : "size-4",
            )}
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

function CurrencySpendingBlock({
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
          <p className="text-2xs text-muted-foreground">{t("groupSpending")}</p>
          <Amount
            minorUnits={stat.groupSpent}
            currency={stat.currency}
            display="code"
            className="mt-0.5 block truncate text-xl font-semibold tracking-[-0.02em]"
          />
        </div>
        <span className="shrink-0 pb-0.5 text-2xs text-muted-foreground tabular-nums">
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
          <dt className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-[7px] rounded-full bg-primary/70"
            />
            {t("statYourShare")}
          </dt>
          <dd className="mt-0.5 truncate text-sm font-semibold">
            <Amount
              minorUnits={stat.yourShare}
              currency={stat.currency}
              display="code"
            />
          </dd>
        </div>
        <div className="pl-3">
          <dt className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            {/* A categorical colour, not the balance green: what you paid is
                a share of the spending, not money owed to you, and beside an
                accent dot the balance green could be the accent itself. */}
            <span
              aria-hidden="true"
              className="size-[7px] rounded-full bg-chart-1/70"
            />
            {t("statYouPaid")}
          </dt>
          <dd className="mt-0.5 truncate text-sm font-semibold">
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
