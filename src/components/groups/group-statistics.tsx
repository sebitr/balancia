"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CalendarOff,
  ChevronDown,
} from "lucide-react";
import { Amount } from "@/components/money/amount";
import { CurrencyHeading } from "@/components/money/currency-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { hasGlyph } from "@/components/expenses/category-icon";
import { useDateFormatter, useFormatPreferences } from "@/i18n/format-context";
import { parsePlainDate } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { TONE, toneFor } from "@/components/money/balance-tone";
import { getSubcategoryGroups } from "@/modules/categorization/taxonomy";
import type { Granularity, StatsRange } from "@/modules/groups/member-stats";

/**
 * The group statistics screen, below its hero.
 *
 * One client island for the whole screen, and three pieces of state in it:
 * which window is being read, which figure the member rows are ranked by, and
 * whether revenue is netted off the total. Everything else is derived, and
 * every figure arrives already computed as decimal strings of minor units —
 * money is not arithmetic a browser should be doing.
 *
 * A group can hold several currencies at once, and they never add up, so the
 * money-bearing blocks repeat per currency, busiest first. What does not
 * repeat is the switcher above them: the window is a property of the reading,
 * not of a currency.
 *
 * Chart labels sit at `text-2xs`, the bottom of the app's scale, rather than
 * at the 10px the design drew them at. Seven sizes is the scale; an eighth
 * spelled `text-[0.625rem]` is how it drifted to fourteen last time.
 *
 * The floor is for labels only. `text-2xs` is 12px on a phone, and the
 * footnotes here — the method note, the flows note, the trend line — are
 * sentences, which the scale says never go there: an axis tick is glanced at
 * beside the mark it names, a sentence is read. Every caption and footnote on
 * these cards is a step up at `text-xs`; what stays on the floor is what the
 * scale names for it, the axis ticks, the pills and the avatar discs.
 */

export interface SpendBucketView {
  readonly start: string;
  readonly amount: string;
  readonly entryCount: number;
}

export interface MemberStandingView {
  readonly participantId: string;
  readonly name: string;
  readonly isSelf: boolean;
  readonly paid: string;
  readonly share: string;
  readonly net: string;
  readonly open: string;
}

export interface SubcategorySliceView {
  readonly subcategory: string;
  readonly amount: string;
  readonly percent: number;
}

export interface GroupCategorySliceView {
  readonly category: string | null;
  readonly known: boolean;
  readonly amount: string;
  readonly percent: number;
  readonly children: readonly SubcategorySliceView[];
  readonly remainder: string;
}

export interface WeekdaySliceView {
  readonly weekday: number;
  readonly entryCount: number;
  readonly amount: string;
}

export interface GroupCurrencyStatsView {
  readonly currency: string;
  readonly totalSpent: string;
  readonly netTotalSpent: string;
  readonly entryCount: number;
  readonly medianEntry: string;
  readonly perPersonMonth: string;
  readonly netPerPersonMonth: string;
  readonly flows: {
    readonly spent: string;
    readonly spentCount: number;
    readonly revenue: string;
    readonly revenueCount: number;
    readonly settled: string;
    readonly settledCount: number;
  };
  readonly buckets: readonly SpendBucketView[];
  readonly bucketMean: string;
  readonly trendPercent: number | null;
  readonly members: readonly MemberStandingView[];
  readonly categories: readonly GroupCategorySliceView[];
  readonly topThreePercent: number;
  readonly weekdays: readonly WeekdaySliceView[];
}

export interface GroupRangeStatsView {
  readonly key: StatsRange;
  readonly granularity: Granularity;
  readonly months: number | null;
  readonly currencies: readonly GroupCurrencyStatsView[];
}

export interface GroupRecordsView {
  readonly currency: string;
  readonly biggestEntry: {
    readonly description: string;
    readonly category: string | null;
    readonly subcategory: string | null;
    readonly date: string;
    readonly amount: string;
    readonly paidBy: string | null;
  } | null;
  readonly longestOpen: {
    readonly from: string;
    readonly to: string;
    readonly days: number;
  } | null;
  readonly longestSquare: {
    readonly from: string;
    readonly to: string;
    readonly days: number;
  } | null;
  readonly busiestWeek: {
    readonly start: string;
    readonly entryCount: number;
    readonly amount: string;
  } | null;
  readonly quietestMonth: {
    readonly month: string;
    readonly entryCount: number;
    readonly amount: string;
  } | null;
}

export interface GroupStatsView {
  readonly currencies: readonly string[];
  readonly firstEntry: string | null;
  readonly memberCount: number;
  readonly ranges: readonly GroupRangeStatsView[];
  readonly records: readonly GroupRecordsView[];
}

const RANGES: readonly StatsRange[] = ["3m", "1y", "all"];

/** The four ways to rank the people carrying a group. */
const METRICS = ["net", "paid", "share", "open"] as const;
type Metric = (typeof METRICS)[number];

/** Net and Open have a sign and a middle; Paid and Share only have a size. */
const SIGNED: Record<Metric, boolean> = {
  net: true,
  paid: false,
  share: false,
  open: true,
};

/** Every card here: one surface, one hairline, one radius. */
const CARD =
  "flex flex-col gap-3 rounded-[17px] bg-card p-3.5 shadow-[0_0_0_1px_var(--border)]";

/**
 * The colours a category split runs through, richest first.
 *
 * Assigned by rank rather than by category, as on the member screen: the
 * vocabulary is eighteen codes long and an imported label can be anything at
 * all. What the reader needs is to tell the rows apart, not to learn that
 * groceries are permanently plum.
 */
const SLICE_COLOURS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "color-mix(in oklch, var(--foreground) 25%, transparent)",
] as const;

export function GroupStatistics({ stats }: { stats: GroupStatsView }) {
  const t = useTranslations("groupStats");
  const [range, setRange] = useState<StatsRange>("1y");
  const [metric, setMetric] = useState<Metric>("net");
  const [net, setNet] = useState(false);

  const selected =
    stats.ranges.find((candidate) => candidate.key === range) ??
    stats.ranges[0];

  return (
    <section
      aria-labelledby="group-statistics"
      className="flex flex-col gap-3.5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="group-statistics"
          className="text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
        >
          {t("spending")}
        </h2>

        <div
          role="tablist"
          aria-label={t("rangeLabel")}
          className="flex gap-0.5 rounded-full bg-wash-2 p-[3px]"
        >
          {RANGES.map((candidate) => (
            <Pill
              key={candidate}
              role="tab"
              active={candidate === range}
              onClick={() => setRange(candidate)}
            >
              {t(`ranges.${candidate}`)}
            </Pill>
          ))}
        </div>
      </div>

      {!selected || selected.currencies.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        selected.currencies.map((entry) => (
          <CurrencyBlock
            key={entry.currency}
            entry={entry}
            range={selected}
            metric={metric}
            onMetric={setMetric}
            net={net}
            onNet={() => setNet((on) => !on)}
            showCurrency={selected.currencies.length > 1}
          />
        ))
      )}

      {stats.records.map((records) => (
        <RecordsCard
          key={records.currency}
          records={records}
          showCurrency={stats.records.length > 1}
        />
      ))}

      <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("method")}
      </p>
    </section>
  );
}

function CurrencyBlock({
  entry,
  range,
  metric,
  onMetric,
  net,
  onNet,
  showCurrency,
}: {
  entry: GroupCurrencyStatsView;
  range: GroupRangeStatsView;
  metric: Metric;
  onMetric: (metric: Metric) => void;
  net: boolean;
  onNet: () => void;
  showCurrency: boolean;
}) {
  const t = useTranslations("groupStats");

  if (entry.entryCount === 0 && entry.flows.revenueCount === 0) {
    return (
      <div className="flex flex-col gap-3.5">
        {showCurrency && <CurrencyHeading currency={entry.currency} />}
        <EmptyState
          icon={CalendarOff}
          title={t("emptyTitle")}
          description={t("emptyRange")}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {showCurrency && <CurrencyHeading currency={entry.currency} />}
      <StatStrip entry={entry} net={net} />
      <Flows entry={entry} net={net} onNet={onNet} />
      <SpendChart entry={entry} range={range} />
      <WhoCarries entry={entry} metric={metric} onMetric={onMetric} />
      <Categories entry={entry} />
      <Rhythm entry={entry} />
    </div>
  );
}

/** A pill in one of the two switchers, which differ only in how they stretch. */
function Pill({
  active,
  onClick,
  role,
  grow,
  children,
}: {
  active: boolean;
  onClick: () => void;
  role?: "tab";
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-selected={role === "tab" ? active : undefined}
      aria-pressed={role === "tab" ? undefined : active}
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0",
        grow && "flex-1",
        active
          ? "bg-card text-foreground shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_12%,transparent)]"
          : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The window in four figures.
 *
 * The median sits beside the total on purpose: one furniture run moves a mean
 * and leaves the median where it was, and the gap between them is what tells
 * a reader whether the total is a habit or an event.
 */
function StatStrip({
  entry,
  net,
}: {
  entry: GroupCurrencyStatsView;
  net: boolean;
}) {
  const t = useTranslations("groupStats");

  const cells = [
    {
      key: "statTotal",
      value: (
        <Amount
          minorUnits={net ? entry.netTotalSpent : entry.totalSpent}
          currency={entry.currency}
        />
      ),
    },
    {
      key: "statPerPerson",
      value: (
        <Amount
          minorUnits={net ? entry.netPerPersonMonth : entry.perPersonMonth}
          currency={entry.currency}
        />
      ),
    },
    { key: "statEntries", value: entry.entryCount },
    {
      key: "statMedian",
      value: (
        <Amount minorUnits={entry.medianEntry} currency={entry.currency} />
      ),
    },
  ] as const;

  return (
    // Borders per cell rather than `divide-*`: on a two-column grid the divide
    // utilities draw a line above the second cell of the first row too.
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl ring-1 ring-border">
      {cells.map((cell, index) => (
        <div
          key={cell.key}
          className={cn(
            "flex min-h-[62px] flex-col justify-between gap-1.5 p-2.5",
            index < 2 && "border-b border-border",
            index % 2 === 0 && "border-r border-border",
          )}
        >
          <dt className="text-2xs leading-tight font-semibold tracking-[0.04em] text-muted-foreground uppercase">
            {t(cell.key)}
          </dt>
          <dd className="truncate text-base font-semibold tracking-[-0.015em] tabular-nums">
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Three sums that are not the same kind of thing.
 *
 * Spending left the group, revenue came into it, and a settlement did
 * neither — it moved a balance between two members. Putting them in one card
 * is the only way to say that out loud; adding them would be nonsense.
 */
function Flows({
  entry,
  net,
  onNet,
}: {
  entry: GroupCurrencyStatsView;
  net: boolean;
  onNet: () => void;
}) {
  const t = useTranslations("groupStats");
  const { flows } = entry;

  const rows = [
    {
      key: "flowExpenses",
      sub: t("flowExpensesSub", { count: flows.spentCount }),
      // Money out, signed as it left: the toggle above subtracts revenue from
      // it, and a reader has to be able to see which way each row points.
      minorUnits: (-BigInt(flows.spent)).toString(),
      tone: "text-foreground",
      chip: "bg-wash-2 text-foreground",
      icon: ArrowUp,
    },
    {
      key: "flowRevenue",
      sub: t("flowRevenueSub", { count: flows.revenueCount }),
      minorUnits: flows.revenue,
      tone: "text-positive-ink",
      chip: "bg-positive/15 text-positive-ink",
      icon: ArrowDown,
    },
    {
      key: "flowSettlements",
      sub: t("flowSettlementsSub", { count: flows.settledCount }),
      minorUnits: flows.settled,
      tone: "text-neutral-balance-ink",
      chip: "bg-wash-2 text-neutral-balance-ink",
      icon: ArrowLeftRight,
    },
  ] as const;

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t("flowsTitle")}</h3>
        <button
          type="button"
          aria-pressed={net}
          onClick={onNet}
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-2xs font-semibold transition-colors motion-reduce:transition-none",
            net
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]",
          )}
        >
          {t("netToggle")}
        </button>
      </div>

      <dl className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2.5 py-2">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-6.5 shrink-0 place-items-center rounded-full",
                row.chip,
              )}
            >
              <row.icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <dt className="text-sm font-medium">{t(row.key)}</dt>
              <dd className="truncate text-xs text-muted-foreground">
                {row.sub}
              </dd>
            </div>
            <span className={cn("shrink-0 text-sm font-semibold", row.tone)}>
              <Amount
                minorUnits={row.minorUnits}
                currency={entry.currency}
                signDisplay={
                  row.key === "flowSettlements" ? "auto" : "exceptZero"
                }
              />
            </span>
          </div>
        ))}
      </dl>

      <p className="text-xs text-pretty text-muted-foreground">
        {t(net ? "flowsFootnoteNet" : "flowsFootnoteGross")}
      </p>
    </div>
  );
}

/** What the group spent, bucket by bucket, against its own average. */
function SpendChart({
  entry,
  range,
}: {
  entry: GroupCurrencyStatsView;
  range: GroupRangeStatsView;
}) {
  const t = useTranslations("groupStats");
  const labels = useBucketLabels(range.granularity);
  const [hovered, setHovered] = useState<number | null>(null);

  const peak = useMemo(
    () =>
      entry.buckets.reduce((top, bucket) => {
        const amount = BigInt(bucket.amount);
        return amount > top ? amount : top;
      }, 0n),
    [entry.buckets],
  );

  if (entry.buckets.length === 0) return null;

  const heightOf = (value: string): number =>
    peak === 0n ? 0 : Number((BigInt(value) * 100n) / peak);

  const axis = [
    0,
    Math.floor((entry.buckets.length - 1) / 2),
    entry.buckets.length - 1,
  ].filter(
    (index, position, all) => index >= 0 && all.indexOf(index) === position,
  );

  const trend = entry.trendPercent;

  return (
    <div className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t("chartTitle")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`granularity.${range.granularity}`, {
              count: entry.buckets.length,
            })}
          </p>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">
          {t.rich("chartAverage", {
            amount: () => (
              <Amount minorUnits={entry.bucketMean} currency={entry.currency} />
            ),
          })}
        </p>
      </div>

      <div className="relative">
        {hovered !== null && entry.buckets[hovered] && (
          <Tip
            position={positionOf(hovered, entry.buckets.length)}
            className="-top-1"
          >
            {labels.tooltip(entry.buckets[hovered].start)}
            {" · "}
            <Amount
              minorUnits={entry.buckets[hovered].amount}
              currency={entry.currency}
            />
          </Tip>
        )}

        <div
          role="img"
          aria-label={t("chartLabel", { count: entry.buckets.length })}
          onPointerLeave={() => setHovered(null)}
          className="relative mt-7 flex h-28 items-end gap-[3px] border-b border-border"
        >
          {/* The mean, drawn where it falls rather than written out: the
              figure itself is already in the caption above. */}
          <span
            aria-hidden="true"
            className="absolute inset-x-0 h-px bg-[color-mix(in_oklch,var(--foreground)_28%,transparent)]"
            style={{ bottom: `${heightOf(entry.bucketMean)}%` }}
          />
          {entry.buckets.map((bucket, position) => (
            <span
              key={bucket.start}
              aria-hidden="true"
              onPointerEnter={() => setHovered(position)}
              onClick={() => setHovered(position === hovered ? null : position)}
              className="flex h-full flex-1 cursor-default items-end"
            >
              <span
                className="w-full rounded-t-[3px]"
                style={{
                  height: `${Math.max(heightOf(bucket.amount), BigInt(bucket.amount) > 0n ? 2 : 0)}%`,
                  background:
                    position === hovered
                      ? "var(--chart-2)"
                      : "color-mix(in oklch, var(--chart-1) 65%, transparent)",
                }}
              />
            </span>
          ))}
        </div>
      </div>

      {/* The series as text. The plot above is one image with a summary, and
          the tooltip is a pointer's affordance; this is where the figures
          themselves are for a reader who has neither. */}
      <ul className="sr-only">
        {entry.buckets.map((bucket) => (
          <li key={bucket.start}>
            {labels.tooltip(bucket.start)}
            {": "}
            <Amount minorUnits={bucket.amount} currency={entry.currency} />
          </li>
        ))}
      </ul>

      <div className="flex justify-between text-2xs text-muted-foreground">
        {axis.map((position) => (
          <span key={position}>
            {entry.buckets[position]
              ? labels.axis(entry.buckets[position].start)
              : ""}
          </span>
        ))}
      </div>

      {trend !== null && (
        <p className="border-t border-border pt-3 text-xs text-pretty text-muted-foreground">
          {t(
            trend > 0 ? "trendAbove" : trend < 0 ? "trendBelow" : "trendLevel",
            { percent: Math.abs(trend) },
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Who carried the group, by whichever of the four figures is being asked
 * about.
 *
 * The rows re-sort and the bars re-scale on every metric, because the four
 * are not comparable: `net` is signed and can be read either way round,
 * `open` is a balance and sums to zero, and `paid` and `share` are sizes with
 * no middle to speak of.
 */
function WhoCarries({
  entry,
  metric,
  onMetric,
}: {
  entry: GroupCurrencyStatsView;
  metric: Metric;
  onMetric: (metric: Metric) => void;
}) {
  const t = useTranslations("groupStats");
  const signed = SIGNED[metric];

  const rows = useMemo(() => {
    const valueOf = (member: MemberStandingView) => BigInt(member[metric]);
    return [...entry.members]
      .map((member) => ({ member, value: valueOf(member) }))
      .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
  }, [entry.members, metric]);

  const peak = rows.reduce((top, row) => {
    const magnitude = row.value < 0n ? -row.value : row.value;
    return magnitude > top ? magnitude : top;
  }, 0n);

  if (rows.length === 0) return null;

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t("membersTitle")}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("membersCaption")}
        </span>
      </div>

      <div
        role="tablist"
        aria-label={t("metricLabel")}
        className="flex gap-0.5 rounded-full bg-wash-2 p-[3px]"
      >
        {METRICS.map((candidate) => (
          <Pill
            key={candidate}
            role="tab"
            grow
            active={candidate === metric}
            onClick={() => onMetric(candidate)}
          >
            {t(`metrics.${candidate}`)}
          </Pill>
        ))}
      </div>

      {/* Three columns declared once on the list, subgridded onto by every
          row, as the balance list does it. The amount track is `auto`, so it
          is as wide as the longest amount in the card actually needs and no
          wider; a fixed width is what pushed a five-figure balance out past
          the card and broke the smaller ones over two lines. Sizing it per
          row instead would fit each amount to itself, and the bars would
          start and end a few pixels apart down the card. The column gap
          belongs to the list alone — a subgrid inherits it, and restating it
          on a row is what pulls the tracks back out of line. */}
      <ul className="grid grid-cols-[minmax(0,1fr)_minmax(40px,0.8fr)_auto] gap-x-2.5 divide-y divide-border">
        {rows.map(({ member, value }) => {
          const magnitude = value < 0n ? -value : value;
          const width =
            peak === 0n
              ? 0
              : Number((magnitude * 100n) / peak) / (signed ? 2 : 1);
          return (
            <li
              key={member.participantId}
              className="col-span-3 grid grid-cols-subgrid items-center py-2"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-6.5 shrink-0 place-items-center rounded-full text-2xs font-semibold",
                    member.isSelf
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-accent-foreground",
                  )}
                >
                  {member.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="truncate text-sm font-medium">
                  {member.name}
                </span>
              </span>

              <span
                aria-hidden="true"
                className="relative h-2 rounded-full bg-wash-2"
              >
                {signed && (
                  <span className="absolute -top-[3px] -bottom-[3px] left-1/2 w-px bg-foreground/30" />
                )}
                <span
                  className={cn(
                    "absolute inset-y-0 rounded-full",
                    !signed && "left-0 bg-[var(--chart-1)]",
                    signed && value >= 0n && `left-1/2 ${TONE.positive.fill}`,
                    signed && value < 0n && `right-1/2 ${TONE.negative.fill}`,
                  )}
                  style={{ width: `${width}%` }}
                />
              </span>

              <span
                className={cn(
                  "text-right text-sm font-semibold tabular-nums",
                  signed && value !== 0n && TONE[toneFor(value)].ink,
                )}
              >
                <Amount
                  minorUnits={value.toString()}
                  currency={entry.currency}
                  signDisplay={signed ? "exceptZero" : "auto"}
                />
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-pretty text-muted-foreground">
        {t(`metricNotes.${metric}`)}
      </p>
    </div>
  );
}

/**
 * Where the money went, one level down when the reader asks.
 *
 * An accordion rather than a permanently open tree: eighteen categories with
 * their subcategories under them is a wall of a hundred rows on a phone, and
 * the question "what is inside Home" is asked one category at a time.
 */
function Categories({ entry }: { entry: GroupCurrencyStatsView }) {
  const t = useTranslations("groupStats");
  const tCategories = useTranslations("expenses.categories");
  const [open, setOpen] = useState<string | null>(null);

  if (entry.categories.length === 0) return null;

  const largest = entry.categories.reduce(
    (top, slice) => (BigInt(slice.amount) > top ? BigInt(slice.amount) : top),
    0n,
  );

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t("categoriesTitle")}</h3>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {t("categoriesCaption", { percent: entry.topThreePercent })}
        </span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {entry.categories.map((slice, position) => {
          const key = slice.category ?? "none";
          const colour =
            SLICE_COLOURS[Math.min(position, SLICE_COLOURS.length - 1)];
          const expandable = slice.children.length > 0;
          const expanded = open === key;
          const width =
            largest === 0n
              ? 0
              : Number((BigInt(slice.amount) * 100n) / largest);
          const label = slice.category
            ? hasGlyph(slice.category)
              ? tCategories(slice.category)
              : slice.category
            : t("uncategorized");

          return (
            <li key={key}>
              <button
                type="button"
                aria-expanded={expandable ? expanded : undefined}
                disabled={!expandable}
                onClick={() => setOpen(expanded ? null : key)}
                className="flex w-full items-center gap-2 text-left"
              >
                <span
                  aria-hidden="true"
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ background: colour }}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    expanded && "font-semibold",
                  )}
                >
                  {label}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  <Amount minorUnits={slice.amount} currency={entry.currency} />
                </span>
                <span className="w-11 shrink-0 text-right text-2xs text-muted-foreground tabular-nums">
                  {t("percent", { percent: slice.percent })}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                    !expandable && "opacity-0",
                    expanded && "rotate-180",
                  )}
                />
              </button>

              <span
                aria-hidden="true"
                className="mt-1.5 block h-1 overflow-hidden rounded-full bg-wash-2"
              >
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${width}%`, background: colour }}
                />
              </span>

              {expanded && (
                <Subcategories
                  slice={slice}
                  label={label}
                  currency={entry.currency}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What opens under a category, and the part of it nobody filed. */
function Subcategories({
  slice,
  label,
  currency,
}: {
  slice: GroupCategorySliceView;
  label: string;
  currency: string;
}) {
  const t = useTranslations("groupStats");
  const tSub = useSubcategoryLabel();
  const tGroups = useTranslations("expenses.categoryGroups");
  const shelves = useShelves(slice.category);

  return (
    <ul className="mt-1 mb-1.5 ml-4 flex flex-col gap-1.5 border-l border-border pl-3">
      {slice.children.map((child) => {
        const shelf = shelves.get(child.subcategory);
        return (
          <li key={child.subcategory} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-secondary-foreground">
              {tSub(slice.category ?? "", child.subcategory)}
            </span>
            {shelf && (
              <span className="shrink-0 rounded-full bg-wash-2 px-1.5 py-px text-2xs text-muted-foreground">
                {tGroups(
                  `${slice.category}.${shelf}` as Parameters<typeof tGroups>[0],
                )}
              </span>
            )}
            <span className="shrink-0 text-xs font-semibold tabular-nums">
              <Amount minorUnits={child.amount} currency={currency} />
            </span>
            <span className="w-9 shrink-0 text-right text-2xs text-muted-foreground tabular-nums">
              {t("percent", { percent: child.percent })}
            </span>
          </li>
        );
      })}

      {BigInt(slice.remainder) > 0n && (
        <li className="text-xs text-pretty text-muted-foreground">
          {t.rich("noSubcategory", {
            category: label,
            amount: () => (
              <Amount minorUnits={slice.remainder} currency={currency} />
            ),
          })}
        </li>
      )}
    </ul>
  );
}

/** Entries by weekday — when this group actually spends. */
function Rhythm({ entry }: { entry: GroupCurrencyStatsView }) {
  const t = useTranslations("groupStats");
  const { narrow, long } = useWeekdayNames();
  const [hovered, setHovered] = useState<number | null>(null);

  const peak = entry.weekdays.reduce(
    (top, day) => (day.entryCount > top ? day.entryCount : top),
    0,
  );
  const busiest = entry.weekdays.reduce(
    (top, day, index) =>
      day.entryCount > entry.weekdays[top].entryCount ? index : top,
    0,
  );

  if (peak === 0) return null;

  const active = hovered ?? busiest;
  const day = entry.weekdays[active];

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t("rhythmTitle")}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("rhythmCaption")}
        </span>
      </div>

      <div className="relative">
        {hovered !== null && (
          <Tip
            position={positionOf(hovered, entry.weekdays.length)}
            className="-top-1"
          >
            {long(day.weekday)}
            {" · "}
            {t("weekdayEntries", { count: day.entryCount })}
            {" · "}
            <Amount minorUnits={day.amount} currency={entry.currency} />
          </Tip>
        )}

        <div
          role="img"
          aria-label={t("rhythmLabel", {
            day: long(entry.weekdays[busiest].weekday),
          })}
          onPointerLeave={() => setHovered(null)}
          className="mt-7 flex gap-1.5"
        >
          {entry.weekdays.map((weekday, position) => (
            <div
              key={weekday.weekday}
              aria-hidden="true"
              onPointerEnter={() => setHovered(position)}
              onClick={() => setHovered(position === hovered ? null : position)}
              className={cn(
                "flex flex-1 cursor-default flex-col items-center gap-1 transition-opacity motion-reduce:transition-none",
                hovered !== null && hovered !== position && "opacity-45",
              )}
            >
              <span className="text-2xs text-muted-foreground tabular-nums">
                {weekday.entryCount}
              </span>
              {/* A fixed-height track, not a flex sibling of the labels: a
                  percentage height needs a resolved one to be a percentage of. */}
              <span className="flex h-13 w-full items-end">
                <span
                  className="w-full rounded-[3px]"
                  style={{
                    height: `${Math.max((weekday.entryCount / peak) * 100, weekday.entryCount > 0 ? 4 : 0)}%`,
                    background:
                      position === active
                        ? "var(--chart-2)"
                        : "color-mix(in oklch, var(--chart-1) 45%, transparent)",
                  }}
                />
              </span>
              <span className="text-2xs text-muted-foreground">
                {narrow(weekday.weekday)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The all-time facts, which no range switcher touches. */
function RecordsCard({
  records,
  showCurrency,
}: {
  records: GroupRecordsView;
  showCurrency: boolean;
}) {
  const t = useTranslations("groupStats");
  const tCategories = useTranslations("expenses.categories");
  const tSub = useSubcategoryLabel();
  const dates = useDateFormatter();
  const { long: monthName } = useMonthNames();

  const rows: {
    key: string;
    label: string;
    sub: string;
    value: React.ReactNode;
  }[] = [];

  if (records.biggestEntry) {
    const entry = records.biggestEntry;
    const category = !entry.category
      ? null
      : hasGlyph(entry.category)
        ? entry.subcategory
          ? `${tCategories(entry.category)} / ${tSub(entry.category, entry.subcategory)}`
          : tCategories(entry.category)
        : entry.category;
    rows.push({
      key: "biggest",
      label: t("recordBiggest"),
      sub: [
        entry.description,
        category,
        dates.plain(entry.date),
        entry.paidBy ? t("recordPaidBy", { name: entry.paidBy }) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      value: <Amount minorUnits={entry.amount} currency={records.currency} />,
    });
  }
  if (records.longestOpen) {
    rows.push({
      key: "longestOpen",
      label: t("recordLongestOpen"),
      sub: t("recordSpan", {
        from: dates.plain(records.longestOpen.from),
        to: dates.plain(records.longestOpen.to),
      }),
      value: t("days", { count: records.longestOpen.days }),
    });
  }
  if (records.busiestWeek) {
    rows.push({
      key: "busiestWeek",
      label: t("recordBusiest"),
      sub: t("recordBusiestSub", {
        date: dates.plain(records.busiestWeek.start),
        count: records.busiestWeek.entryCount,
      }),
      value: (
        <Amount
          minorUnits={records.busiestWeek.amount}
          currency={records.currency}
        />
      ),
    });
  }
  if (records.quietestMonth) {
    const month = records.quietestMonth;
    rows.push({
      key: "quietestMonth",
      label: t("recordQuietest"),
      sub: t("recordQuietestSub", {
        month: monthName.format(parsePlainDate(month.month)),
        count: month.entryCount,
      }),
      value: <Amount minorUnits={month.amount} currency={records.currency} />,
    });
  }
  if (records.longestSquare) {
    rows.push({
      key: "longestSquare",
      label: t("recordSquare"),
      sub: t("recordSquareSub", {
        from: dates.plain(records.longestSquare.from),
        to: dates.plain(records.longestSquare.to),
      }),
      value: t("days", { count: records.longestSquare.days }),
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t("recordsTitle")}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {showCurrency
            ? `${records.currency} · ${t("allTime")}`
            : t("allTime")}
        </span>
      </div>

      <dl className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <dt className="text-sm font-medium">{row.label}</dt>
              <dd className="truncate text-xs text-muted-foreground">
                {row.sub}
              </dd>
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {row.value}
            </span>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * A tooltip above whatever it describes, which cannot leave its card.
 *
 * The same mechanic as the member screen: aligned to the near end rather than
 * centred and clamped, because a clamp needs to know how wide the pill is and
 * this one holds a localised amount.
 */
function Tip({
  position,
  className,
  children,
}: {
  position: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // Hidden from assistive technology on purpose: the chart it floats over
    // already carries a summary, and the figures are in the DOM as text.
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 flex",
        position < 30
          ? "justify-start"
          : position > 70
            ? "justify-end"
            : "justify-center",
        className,
      )}
    >
      <span className="max-w-full truncate rounded-[0.6rem] bg-foreground px-2 py-1 text-2xs font-medium text-background tabular-nums">
        {children}
      </span>
    </span>
  );
}

/** Where a tooltip sits over an evenly divided row. */
function positionOf(index: number, count: number): number {
  if (count <= 1) return 50;
  return ((index + 0.5) / count) * 100;
}

/**
 * The shelf a subcategory sits on, when its category has any.
 *
 * Presentation only, and read from the taxonomy rather than stored: `home` is
 * twenty chips long, and "Rent, Electricity, Furniture" reads as three
 * unrelated things until Housing, Utilities and Supplies are written beside
 * them.
 */
function useShelves(category: string | null): ReadonlyMap<string, string> {
  return useMemo(() => {
    const shelves = new Map<string, string>();
    const groups = hasGlyph(category) ? getSubcategoryGroups(category) : null;
    for (const { group, subcategories } of groups ?? []) {
      for (const subcategory of subcategories) shelves.set(subcategory, group);
    }
    return shelves;
  }, [category]);
}

/**
 * The reader's label for a (category, subcategory) pair.
 *
 * The cast is what the nesting costs: `t()` is typed over the literal key
 * paths in `en.json`, and the cross product of parents and leaves is mostly
 * not real paths. The pairs reaching this are, because they came out of the
 * taxonomy in the first place.
 */
function useSubcategoryLabel(): (
  category: string,
  subcategory: string,
) => string {
  const tSub = useTranslations("expenses.subcategories");
  return (category, subcategory) =>
    tSub(`${category}.${subcategory}` as Parameters<typeof tSub>[0]);
}

/** How a bucket is named on the axis and in the tooltip. */
function useBucketLabels(granularity: Granularity): {
  axis: (start: string) => string;
  tooltip: (start: string) => string;
} {
  const dates = useDateFormatter();
  const { shortWithYear } = useMonthNames();

  return useMemo(() => {
    if (granularity === "week") {
      const week = (start: string) => dates.plain(start, "dayMonth");
      return { axis: week, tooltip: week };
    }
    return {
      axis: (start) => shortWithYear.format(parsePlainDate(start)),
      tooltip: (start) => shortWithYear.format(parsePlainDate(start)),
    };
  }, [dates, granularity, shortWithYear]);
}

/**
 * Month names, in the reader's language.
 *
 * From `Intl` directly rather than through the reader's date *notation*: that
 * preference settles the order of a numeric date, and there is no order to
 * settle in "Apr".
 */
function useMonthNames(): {
  short: Intl.DateTimeFormat;
  long: Intl.DateTimeFormat;
  shortWithYear: Intl.DateTimeFormat;
} {
  const { formatLocale } = useFormatPreferences();
  return useMemo(
    () => ({
      short: new Intl.DateTimeFormat(formatLocale, {
        month: "short",
        timeZone: "UTC",
      }),
      long: new Intl.DateTimeFormat(formatLocale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      shortWithYear: new Intl.DateTimeFormat(formatLocale, {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }),
    }),
    [formatLocale],
  );
}

/**
 * Weekday names, narrow for the axis and long for the tooltip.
 *
 * Formatted off a known week rather than written down: "M T W T F S S" is
 * English, and a French reader's row reads "L M M J V S D".
 */
function useWeekdayNames(): {
  narrow: (weekday: number) => string;
  long: (weekday: number) => string;
} {
  const { formatLocale } = useFormatPreferences();
  return useMemo(() => {
    // 1 January 2024 was a Monday, which is weekday 1 in the data.
    const dayOf = (weekday: number) => new Date(Date.UTC(2024, 0, weekday));
    const narrow = new Intl.DateTimeFormat(formatLocale, {
      weekday: "narrow",
      timeZone: "UTC",
    });
    const long = new Intl.DateTimeFormat(formatLocale, {
      weekday: "long",
      timeZone: "UTC",
    });
    return {
      narrow: (weekday) => narrow.format(dayOf(weekday)),
      long: (weekday) => long.format(dayOf(weekday)),
    };
  }, [formatLocale]);
}
