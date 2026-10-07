"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { BarChart3, ChevronDown, ChevronRight } from "lucide-react";
import { hasGlyph } from "@/components/expenses/category-icon";
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

export interface CategorySpendView {
  /** A category code, an imported label, or null for spending nobody filed. */
  readonly category: string | null;
  readonly amount: string;
}

export interface SpendingPeriodView {
  readonly key: SpendingPeriodKey;
  readonly stats: readonly {
    readonly currency: string;
    readonly groupSpent: string;
    readonly youPaid: string;
    readonly yourShare: string;
    /** The total taken apart, largest first — see `categorySpendOf`. */
    readonly categories: readonly CategorySpendView[];
  }[];
}

/** Rows the category bars show before folding the rest into one. */
const CATEGORY_ROWS = 5;

/**
 * The bars' colours, by rank, as the statistics screens assign them: what the
 * reader needs is to tell the rows apart, not to learn that groceries are
 * always one colour.
 *
 * Categorical colours only. Never a money colour, since a bar here is spending
 * and not a balance, and never `--chart-2`, which is the accent: the accent is
 * the "you" series and the share bar above, and a category drawn in it would
 * read as the reader's own. The fifth is the first again, faded, rather than
 * a sixth hue nobody could tell from its neighbours.
 */
const CATEGORY_COLOURS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "color-mix(in oklch, var(--chart-1) 45%, var(--card))",
] as const;

/** The row the tail folds into: grey, because it is no one category. */
const FOLDED_COLOUR = "color-mix(in oklch, var(--foreground) 25%, transparent)";

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
 *
 * From `lg` up both shapes also say what the period's spending went on — see
 * `CategoryBars`. Below it nothing about the card changes.
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

            {/* One block per currency, each named, after the lines that give
                each its total — the way the lines themselves are kept apart. */}
            {period.stats.map((stat) => (
              <CategoryBars
                key={stat.currency}
                stat={stat}
                named
                className="border-t pt-3"
              />
            ))}
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
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-wash-3"
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
            <Amount minorUnits={stat.yourShare} currency={stat.currency} />
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
            <Amount minorUnits={stat.youPaid} currency={stat.currency} />
          </dd>
        </div>
      </dl>

      <CategoryBars
        stat={stat}
        named={false}
        className="mt-3.5 border-t pt-3.5"
      />
    </div>
  );
}

/**
 * What the period's spending went on, from `lg` up.
 *
 * A phone keeps the card as it was — the total, the reader's part of it, and
 * the Statistics row, behind which the categories have a screen of their own.
 * Beside the sidebar the right-hand column has the room to answer "on what"
 * without the push, so it does: five rows at most, largest first, the rest
 * folded into one, and the whole split one row further down.
 *
 * The amounts are spending, not anybody's balance, so they are plain ink with
 * no sign and no money colour; the bars take the categorical colours above.
 * Each bar is scaled to the largest row in its own currency. A group with
 * several currencies gets one block per currency, each headed by its code —
 * never one axis, or one list, across two of them.
 */
function CategoryBars({
  stat,
  named,
  className,
}: {
  stat: SpendingPeriodView["stats"][number];
  /** Head the block with its currency, for a card that holds several. */
  named: boolean;
  className?: string;
}) {
  const t = useTranslations("groupStats");
  const tMember = useTranslations("memberStats");
  const tCategories = useTranslations("expenses.categories");

  const rows: readonly (CategorySpendView & { folded?: true })[] =
    stat.categories.length <= CATEGORY_ROWS
      ? stat.categories
      : [
          ...stat.categories.slice(0, CATEGORY_ROWS - 1),
          {
            folded: true,
            category: null,
            amount: stat.categories
              .slice(CATEGORY_ROWS - 1)
              .reduce((total, slice) => total + BigInt(slice.amount), 0n)
              .toString(),
          },
        ];

  // A period with nothing spent in this currency has nothing to take apart.
  if (rows.length === 0) return null;

  const largest = rows.reduce(
    (top, row) => (BigInt(row.amount) > top ? BigInt(row.amount) : top),
    0n,
  );

  return (
    <div className={cn("hidden flex-col gap-2.5 lg:flex", className)}>
      <h3 className="flex items-baseline justify-between gap-3 text-xs font-medium tracking-[0.05em] text-muted-foreground uppercase">
        {t("categoriesTitle")}
        {named && <span className="font-semibold">{stat.currency}</span>}
      </h3>

      {/* The three columns belong to the list and every row subgrids onto
          them, as the balance list's do, so the bars start and end at the
          same place down the card whatever length each figure is. */}
      <ul className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] gap-x-3 gap-y-2.5">
        {rows.map((row, position) => {
          const colour = row.folded
            ? FOLDED_COLOUR
            : CATEGORY_COLOURS[Math.min(position, CATEGORY_COLOURS.length - 1)];
          const label = row.folded
            ? tMember("otherCategories")
            : row.category === null
              ? t("uncategorized")
              : hasGlyph(row.category)
                ? tCategories(row.category)
                : row.category;
          const width =
            largest === 0n ? 0 : Number((BigInt(row.amount) * 100n) / largest);

          return (
            <li
              key={`${row.category ?? "none"}-${position}`}
              className="col-span-3 grid grid-cols-subgrid items-center text-sm"
            >
              <span className="truncate">{label}</span>
              <span aria-hidden="true" className="block">
                <span
                  className="block h-2 rounded-full"
                  style={{ width: `${width}%`, background: colour }}
                />
              </span>
              <Amount
                minorUnits={row.amount}
                currency={stat.currency}
                className="text-right font-medium"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
