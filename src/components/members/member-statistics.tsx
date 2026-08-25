"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarOff } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Amount } from "@/components/money/amount";
import { CurrencyHeading } from "@/components/money/currency-heading";
import {
  CATEGORY_GLYPHS,
  FALLBACK_GLYPH,
  hasGlyph,
} from "@/components/expenses/category-icon";
import { useDateFormatter, useFormatPreferences } from "@/i18n/format-context";
import { parsePlainDate } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { Granularity, StatsRange } from "@/modules/groups/member-stats";

/**
 * The statistics half of a member's screen.
 *
 * Everything below the position card, and the only client island on it: three
 * pieces of state live here — which window is being read, and which bar or
 * which day the reader is pointing at. Every figure arrives already computed,
 * as decimal strings of minor units, because money is not arithmetic a browser
 * should be doing.
 *
 * A group can hold several currencies at once, and they never add up. So the
 * money-bearing cards repeat per currency, busiest first, exactly as the stat
 * strip on the overview does. The heatmap does not repeat: it counts entries,
 * and an entry is one entry whichever currency it was in.
 *
 * Axis and legend labels sit at `text-2xs`, the bottom of the app's scale,
 * rather than at the 10px the design drew them at. The scale is seven sizes
 * and an eighth spelled `text-[0.625rem]` is how it drifted to fourteen last
 * time; a point of extra size on a chart label is the cheaper of the two.
 *
 * That floor is for labels only — see the same note on `group-statistics`.
 * The captions and footnotes here are sentences, so they sit a step up at
 * `text-xs`; the axis, the legend, the tooltip and the avatar discs stay.
 */

export interface StatsBucketView {
  readonly start: string;
  readonly paid: string;
  readonly share: string;
}

export interface MemberShareView {
  readonly participantId: string;
  readonly name: string;
  readonly percent: number;
  readonly isSubject: boolean;
}

export interface CategorySliceView {
  readonly category: string | null;
  readonly amount: string;
  readonly percent: number;
}

export interface SplitPartnerView {
  readonly participantId: string;
  readonly name: string;
  readonly entryCount: number;
  readonly amount: string;
}

export interface CurrencyStatsView {
  readonly currency: string;
  readonly paid: string;
  readonly share: string;
  readonly entryCount: number;
  readonly groupSpent: string;
  readonly payerIndex: number | null;
  readonly sharePercent: number;
  readonly rank: number;
  readonly evenPercent: number;
  readonly medianPercent: number;
  readonly members: readonly MemberShareView[];
  readonly buckets: readonly StatsBucketView[];
  readonly categories: readonly CategorySliceView[];
  readonly partners: readonly SplitPartnerView[];
  readonly topPartnerPercent: number | null;
}

export interface RangeStatsView {
  readonly key: StatsRange;
  readonly granularity: Granularity;
  readonly months: number | null;
  readonly currencies: readonly CurrencyStatsView[];
}

export interface ActivityDayView {
  readonly date: string;
  readonly count: number;
  readonly amounts: readonly { currency: string; amount: string }[];
}

export interface RecordsView {
  readonly currency: string;
  readonly biggestBill: {
    readonly description: string;
    readonly category: string | null;
    readonly date: string;
    readonly amount: string;
  } | null;
  readonly longestDebt: {
    readonly from: string;
    readonly to: string;
    readonly days: number;
    readonly owing: boolean;
  } | null;
  readonly fastestSettle: {
    readonly hours: number;
    readonly on: string;
  } | null;
  readonly quietestMonth: {
    readonly month: string;
    readonly entryCount: number;
    readonly amount: string;
  } | null;
}

export interface MemberStatsView {
  readonly currencies: readonly string[];
  readonly firstEntry: string | null;
  readonly ranges: readonly RangeStatsView[];
  readonly activity: {
    readonly days: readonly ActivityDayView[];
    readonly longestRun: number;
    readonly currentRun: number;
  };
  readonly records: readonly RecordsView[];
}

const RANGES: readonly StatsRange[] = ["3m", "1y", "all"];

/** Every card here: one surface, one hairline, one radius. */
const CARD =
  "flex flex-col gap-3 rounded-[17px] bg-card p-3.5 shadow-[0_0_0_1px_var(--border)]";

/**
 * The colours a category split runs through, richest first.
 *
 * Assigned by rank rather than by category, because the vocabulary is
 * eighteen codes long and an imported label can be anything at all. What the
 * reader needs is to tell six rows apart, not to learn that groceries are
 * permanently plum.
 */
const SLICE_COLOURS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "color-mix(in oklch, var(--foreground) 25%, transparent)",
] as const;

/** Rows the category card shows before folding the tail into one. */
const CATEGORY_ROWS = 6;

export function MemberStatistics({
  name,
  viewingSelf,
  stats,
}: {
  name: string;
  viewingSelf: boolean;
  stats: MemberStatsView;
}) {
  const t = useTranslations("memberStats");
  const [range, setRange] = useState<StatsRange>("1y");

  const selected =
    stats.ranges.find((candidate) => candidate.key === range) ??
    stats.ranges[0];

  return (
    <section
      aria-labelledby="member-statistics"
      className="flex flex-col gap-3.5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="member-statistics"
          className="text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
        >
          {t("statistics")}
        </h2>

        <div
          role="tablist"
          aria-label={t("rangeLabel")}
          className="flex gap-0.5 rounded-full bg-foreground/[0.06] p-[3px]"
        >
          {RANGES.map((candidate) => {
            const active = candidate === range;
            return (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setRange(candidate)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0",
                  active
                    ? "bg-card text-foreground shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_12%,transparent)]"
                    : "text-muted-foreground",
                )}
              >
                {t(`ranges.${candidate}`)}
              </button>
            );
          })}
        </div>
      </div>

      {!selected || selected.currencies.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title={t("emptyTitle")}
          description={t(viewingSelf ? "emptyYou" : "emptyThem", { name })}
        />
      ) : (
        selected.currencies.map((entry) => (
          <CurrencyBlock
            key={entry.currency}
            entry={entry}
            range={selected}
            name={name}
            viewingSelf={viewingSelf}
            showCurrency={selected.currencies.length > 1}
          />
        ))
      )}

      <ActivityCard
        days={stats.activity.days}
        longestRun={stats.activity.longestRun}
        currentRun={stats.activity.currentRun}
      />

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
  name,
  viewingSelf,
  showCurrency,
}: {
  entry: CurrencyStatsView;
  range: RangeStatsView;
  name: string;
  viewingSelf: boolean;
  showCurrency: boolean;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      {showCurrency && <CurrencyHeading currency={entry.currency} />}
      <StatStrip entry={entry} viewingSelf={viewingSelf} />
      <PaidAgainstShare
        entry={entry}
        range={range}
        name={name}
        viewingSelf={viewingSelf}
      />
      <ShareOfGroup entry={entry} />
      <CategorySplit entry={entry} viewingSelf={viewingSelf} />
      <SplitsMostWith entry={entry} viewingSelf={viewingSelf} />
    </div>
  );
}

/** Paid · share · entries, the three figures a window comes down to. */
function StatStrip({
  entry,
  viewingSelf,
}: {
  entry: CurrencyStatsView;
  viewingSelf: boolean;
}) {
  const t = useTranslations("memberStats");
  return (
    <dl className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl ring-1 ring-border">
      <Cell label={t("statPaid")}>
        <Amount minorUnits={entry.paid} currency={entry.currency} />
      </Cell>
      <Cell label={t(viewingSelf ? "statYourShare" : "statTheirShare")}>
        <Amount minorUnits={entry.share} currency={entry.currency} />
      </Cell>
      <Cell label={t("statEntries")}>{entry.entryCount}</Cell>
    </dl>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    // Label at the top and figure at the bottom, so a label that wraps in a
    // longer language pushes its own cell taller without shunting the figure
    // beside it out of line.
    <div className="flex min-h-[62px] flex-col justify-between gap-1.5 p-2.5">
      <dt className="text-2xs leading-tight font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="truncate text-sm font-semibold tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/**
 * What they put in, against what was theirs to carry, bucket by bucket.
 *
 * Two bars a bucket rather than one net line: the whole point of the card is
 * that those two figures come apart, and a difference drawn as a single signed
 * value hides which of them moved.
 */
function PaidAgainstShare({
  entry,
  range,
  name,
  viewingSelf,
}: {
  entry: CurrencyStatsView;
  range: RangeStatsView;
  name: string;
  viewingSelf: boolean;
}) {
  const t = useTranslations("memberStats");
  const labels = useBucketLabels(range.granularity);
  const [hovered, setHovered] = useState<number | null>(null);

  const peak = useMemo(
    () =>
      entry.buckets.reduce((top, bucket) => {
        const paid = BigInt(bucket.paid);
        const share = BigInt(bucket.share);
        const larger = paid > share ? paid : share;
        return larger > top ? larger : top;
      }, 0n),
    [entry.buckets],
  );

  const heightOf = (value: string): number =>
    peak === 0n ? 0 : Number((BigInt(value) * 100n) / peak);

  const axis = [
    0,
    Math.floor((entry.buckets.length - 1) / 2),
    entry.buckets.length - 1,
  ].filter(
    (index, position, all) => index >= 0 && all.indexOf(index) === position,
  );

  const index = entry.payerIndex;
  // 0.5× to 2.5×, with 1.0× a quarter of the way along — the domain a reader
  // can place themselves in without a legend telling them what "high" is.
  const fill =
    index === null ? 0 : Math.max(0, Math.min(100, ((index - 0.5) / 2) * 100));

  // No money in the label: the two figures it would read out are already the
  // strip above this card, and a screen reader hearing them twice learns
  // nothing the second time.
  const summary =
    index === null
      ? t("chartSummaryNone", { count: entry.buckets.length })
      : t("chartSummary", { count: entry.buckets.length, index });

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
        <ul className="flex shrink-0 flex-col gap-1">
          <Legend colour="var(--chart-2)" label={t("legendPaid")} />
          <Legend colour="var(--chart-1)" label={t("legendShare")} />
        </ul>
      </div>

      <div className="relative">
        {hovered !== null && entry.buckets[hovered] && (
          <Tip
            position={positionOf(hovered, entry.buckets.length, 12, 88)}
            className="-top-1"
          >
            {labels.tooltip(entry.buckets[hovered].start)}
            {" · "}
            {t("legendPaid")}{" "}
            <Amount
              minorUnits={entry.buckets[hovered].paid}
              currency={entry.currency}
            />
            {" · "}
            {t("legendShare")}{" "}
            <Amount
              minorUnits={entry.buckets[hovered].share}
              currency={entry.currency}
            />
          </Tip>
        )}

        <div
          role="img"
          aria-label={summary}
          onPointerLeave={() => setHovered(null)}
          // Wider between the pairs than inside them, so a bucket reads as one
          // comparison rather than as two bars that happen to be adjacent.
          className="mt-7 flex h-26 items-end gap-1 border-b border-border"
        >
          {entry.buckets.map((bucket, position) => (
            <div
              key={bucket.start}
              aria-hidden="true"
              onPointerEnter={() => setHovered(position)}
              onClick={() => setHovered(position === hovered ? null : position)}
              className={cn(
                "flex h-full flex-1 cursor-default items-end justify-center gap-0.5 transition-opacity motion-reduce:transition-none",
                hovered !== null && hovered !== position && "opacity-45",
              )}
            >
              <Bar height={heightOf(bucket.paid)} colour="var(--chart-2)" />
              <Bar height={heightOf(bucket.share)} colour="var(--chart-1)" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between text-2xs text-muted-foreground">
        {axis.map((position) => (
          <span key={position}>
            {entry.buckets[position]
              ? labels.axis(entry.buckets[position].start)
              : ""}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-xs text-pretty text-muted-foreground">
            {index === null
              ? t("payerIndexNone")
              : t(viewingSelf ? "payerIndexYou" : "payerIndexThem", {
                  name,
                  index,
                })}
          </p>
          <p className="shrink-0 text-lg font-semibold tabular-nums">
            {index === null ? "—" : t("times", { index })}
          </p>
        </div>

        <div className="relative h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_oklch,var(--chart-2)_70%,transparent)]"
            style={{ width: `${fill}%` }}
          />
          <span className="absolute inset-y-0 left-1/4 w-px bg-foreground/35" />
        </div>

        <div className="flex justify-between text-2xs text-muted-foreground">
          <span>{t("times", { index: 0.5 })}</span>
          <span>{t("payerIndexEven")}</span>
          <span>{t("times", { index: 2.5 })}</span>
        </div>
      </div>
    </div>
  );
}

function Bar({ height, colour }: { height: number; colour: string }) {
  return (
    <span
      className="w-full max-w-[6px] shrink-0 rounded-t-[2px]"
      style={{
        height: `${Math.max(height, height > 0 ? 2 : 0)}%`,
        background: colour,
      }}
    />
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-2xs text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-[7px] rounded-full"
        style={{ background: colour }}
      />
      {label}
    </li>
  );
}

/**
 * A tooltip above whatever it describes, which cannot leave its card.
 *
 * Laid out as a full-width row with the pill aligned inside it rather than
 * centred on the thing it names and nudged back with a clamp. A clamp only
 * works if you know how wide the pill is, and this one is a sentence with two
 * localised amounts in it — a percentage that behaves in English at 390px
 * overflows the first time the same sentence is read in French. Leaning to the
 * near end says which half of the chart is being read, which is as much as the
 * pointer already sitting on the bar needs.
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
    // already carries a summary, and a tooltip that fired on every pointer
    // move would read the same series out one bar at a time.
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

/** Where a tooltip sits over an evenly divided row, kept inside its card. */
function positionOf(
  index: number,
  count: number,
  min: number,
  max: number,
): number {
  if (count <= 1) return 50;
  const centre = ((index + 0.5) / count) * 100;
  return Math.max(min, Math.min(max, centre));
}

/** How much of what the group spent was theirs, and where that puts them. */
function ShareOfGroup({ entry }: { entry: CurrencyStatsView }) {
  const t = useTranslations("memberStats");
  return (
    <div className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t("shareTitle")}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t.rich("shareCaption", {
              amount: () => (
                <Amount
                  minorUnits={entry.groupSpent}
                  currency={entry.currency}
                />
              ),
            })}
          </p>
        </div>
        <p className="shrink-0 text-xl font-semibold tabular-nums">
          {t("percent", { percent: entry.sharePercent })}
        </p>
      </div>

      <div
        role="img"
        aria-label={t("shareBarLabel", {
          percent: entry.sharePercent,
          rank: entry.rank,
          count: entry.members.length,
        })}
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
      >
        {entry.members.map((member) => (
          <span
            key={member.participantId}
            className={cn(
              "h-full first:rounded-l-full last:rounded-r-full",
              member.isSubject
                ? "bg-[var(--chart-2)]"
                : "bg-[color-mix(in_oklch,var(--chart-1)_30%,transparent)]",
            )}
            style={{ width: `${member.percent}%` }}
          />
        ))}
      </div>

      <p className="text-xs text-pretty text-muted-foreground">
        {t("shareFootnote", {
          rank: entry.rank,
          count: entry.members.length,
          median: entry.medianPercent,
          even: entry.evenPercent,
        })}
      </p>
    </div>
  );
}

/** Where their share went, biggest first, six rows at most. */
function CategorySplit({
  entry,
  viewingSelf,
}: {
  entry: CurrencyStatsView;
  viewingSelf: boolean;
}) {
  const t = useTranslations("memberStats");
  const tCategories = useTranslations("expenses.categories");

  // Six rows, always. Past that the tail folds into one — eighteen categories
  // down a phone screen is a list, not a split.
  const rows: readonly (CategorySliceView & { folded?: boolean })[] =
    useMemo(() => {
      if (entry.categories.length <= CATEGORY_ROWS) return entry.categories;
      const tail = entry.categories.slice(CATEGORY_ROWS - 1);
      return [
        ...entry.categories.slice(0, CATEGORY_ROWS - 1),
        {
          folded: true,
          category: null,
          amount: tail
            .reduce((total, slice) => total + BigInt(slice.amount), 0n)
            .toString(),
          percent:
            Math.round(
              tail.reduce((total, slice) => total + slice.percent, 0) * 10,
            ) / 10,
        },
      ];
    }, [entry.categories]);

  if (rows.length === 0) return null;

  const largest = rows.reduce(
    (top, row) => (BigInt(row.amount) > top ? BigInt(row.amount) : top),
    0n,
  );

  return (
    <div className={CARD}>
      <h3 className="text-sm font-medium">
        {t(viewingSelf ? "categoriesYou" : "categoriesThem")}
      </h3>

      <ul className="flex flex-col gap-2.5">
        {rows.map((row, position) => {
          const colour =
            SLICE_COLOURS[Math.min(position, SLICE_COLOURS.length - 1)];
          const Glyph = hasGlyph(row.category)
            ? CATEGORY_GLYPHS[row.category]
            : FALLBACK_GLYPH;
          const label = row.folded
            ? t("otherCategories")
            : row.category === null
              ? t("uncategorized")
              : hasGlyph(row.category)
                ? tCategories(row.category)
                : row.category;
          const width =
            largest === 0n ? 0 : Number((BigInt(row.amount) * 100n) / largest);

          return (
            <li key={`${row.category ?? "none"}-${position}`}>
              <div className="flex items-center gap-2">
                <Glyph
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                  style={{ color: colour }}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  <Amount minorUnits={row.amount} currency={entry.currency} />
                </span>
                <span className="w-10 shrink-0 text-right text-2xs text-muted-foreground tabular-nums">
                  {t("percent", { percent: row.percent })}
                </span>
              </div>
              <span
                aria-hidden="true"
                className="mt-1.5 block h-1 overflow-hidden rounded-full bg-foreground/[0.07]"
              >
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${width}%`, background: colour }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Who they keep ending up on an entry with. */
function SplitsMostWith({
  entry,
  viewingSelf,
}: {
  entry: CurrencyStatsView;
  viewingSelf: boolean;
}) {
  const t = useTranslations("memberStats");
  if (entry.partners.length === 0) return null;
  const top = entry.partners[0];

  return (
    <div className={CARD}>
      <h3 className="text-sm font-medium">{t("partnersTitle")}</h3>

      <ul className="flex flex-col divide-y divide-border">
        {entry.partners.map((partner) => (
          <li
            key={partner.participantId}
            className="flex items-center gap-2.5 py-2"
          >
            <Avatar className="size-7 shrink-0">
              <AvatarFallback className="bg-accent text-2xs font-semibold text-accent-foreground">
                {partner.name.trim().charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                {partner.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {t("sharedEntries", { count: partner.entryCount })}
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              <Amount minorUnits={partner.amount} currency={entry.currency} />
            </span>
          </li>
        ))}
      </ul>

      {entry.topPartnerPercent !== null && (
        <p className="text-xs text-pretty text-muted-foreground">
          {t(viewingSelf ? "partnersFootnoteYou" : "partnersFootnoteThem", {
            name: top.name,
            percent: entry.topPartnerPercent,
          })}
        </p>
      )}
    </div>
  );
}

/** 26 weeks of squares — were they around, rather than how much. */
function ActivityCard({
  days,
  longestRun,
  currentRun,
}: {
  days: readonly ActivityDayView[];
  longestRun: number;
  currentRun: number;
}) {
  const t = useTranslations("memberStats");
  const dates = useDateFormatter();
  const { short: monthName } = useMonthNames();
  const [hovered, setHovered] = useState<number | null>(null);

  const weeks = useMemo(() => {
    const chunks: ActivityDayView[][] = [];
    for (let start = 0; start < days.length; start += 7) {
      chunks.push(days.slice(start, start + 7));
    }
    return chunks;
  }, [days]);

  const day = hovered === null ? null : days[hovered];
  const total = days.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t("activityTitle")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("activityCaption")}
          </p>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {t("runs", { longest: longestRun, current: currentRun })}
        </p>
      </div>

      <div className="relative">
        {day && hovered !== null && (
          <Tip
            position={positionOf(Math.floor(hovered / 7), weeks.length, 14, 86)}
            className="-top-1"
          >
            {dates.plain(day.date)}
            {" · "}
            {t("entriesCount", { count: day.count })}
            {day.amounts.map((entry) => (
              <span key={entry.currency}>
                {" · "}
                <Amount minorUnits={entry.amount} currency={entry.currency} />
              </span>
            ))}
          </Tip>
        )}

        <div
          role="img"
          aria-label={t("activityLabel", { count: total, days: days.length })}
          onPointerLeave={() => setHovered(null)}
          className="mt-7 flex gap-0.5"
        >
          {weeks.map((week, column) => (
            <div key={column} className="flex flex-1 flex-col gap-0.5">
              {week.map((entry, row) => {
                const position = column * 7 + row;
                return (
                  <span
                    key={entry.date}
                    aria-hidden="true"
                    onPointerEnter={() => setHovered(position)}
                    onClick={() =>
                      setHovered(position === hovered ? null : position)
                    }
                    className={cn(
                      "aspect-square rounded-[2px]",
                      position === hovered
                        ? "bg-[var(--chart-2)]"
                        : SHADES[Math.min(entry.count, 3)],
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between text-2xs text-muted-foreground">
        {[0, Math.floor(weeks.length / 2), weeks.length - 1].map((column) => {
          const first = weeks[column]?.[0];
          return (
            <span key={column}>
              {first ? monthName.format(parsePlainDate(first.date)) : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Nothing, a little, a lot — four steps, because a fifth reads as noise. */
const SHADES = [
  "bg-foreground/[0.06]",
  "bg-[color-mix(in_oklch,var(--chart-1)_30%,transparent)]",
  "bg-[color-mix(in_oklch,var(--chart-1)_60%,transparent)]",
  "bg-[var(--chart-1)]",
] as const;

/** The four all-time facts, which no range switcher touches. */
function RecordsCard({
  records,
  showCurrency,
}: {
  records: RecordsView;
  showCurrency: boolean;
}) {
  const t = useTranslations("memberStats");
  const tCategories = useTranslations("expenses.categories");
  const dates = useDateFormatter();
  const { long: monthName } = useMonthNames();

  const rows: {
    key: string;
    label: string;
    sub: string;
    value: React.ReactNode;
  }[] = [];

  if (records.biggestBill) {
    const bill = records.biggestBill;
    const category = !bill.category
      ? null
      : hasGlyph(bill.category)
        ? tCategories(bill.category)
        : bill.category;
    rows.push({
      key: "biggestBill",
      label: t("recordBiggest"),
      sub: [bill.description, category, dates.plain(bill.date)]
        .filter(Boolean)
        .join(" · "),
      value: <Amount minorUnits={bill.amount} currency={records.currency} />,
    });
  }
  if (records.longestDebt) {
    const debt = records.longestDebt;
    rows.push({
      key: "longestDebt",
      label: t("recordLongestDebt"),
      sub: t("recordLongestDebtSub", {
        from: dates.plain(debt.from),
        to: dates.plain(debt.to),
      }),
      value: t("days", { count: debt.days }),
    });
  }
  if (records.fastestSettle) {
    rows.push({
      key: "fastestSettle",
      label: t("recordFastest"),
      sub: t("recordFastestSub", { on: dates.plain(records.fastestSettle.on) }),
      value: t("hours", { hours: records.fastestSettle.hours }),
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
 * How a bucket is named on the axis and in the tooltip.
 *
 * A week is a date, so it goes through the reader's own notation. A month or a
 * quarter is not, so it is named rather than written out — see `useMonthNames`
 * for why. Quarters carry the year because a series long enough to need them
 * has run through more than one.
 */
function useBucketLabels(granularity: Granularity): {
  axis: (start: string) => string;
  tooltip: (start: string) => string;
} {
  const dates = useDateFormatter();
  const { short, shortWithYear } = useMonthNames();

  return useMemo(() => {
    // Short both times: the tooltip sits inside the card beside two amounts,
    // and a bucket spelled out in full is what pushes that sentence past the
    // edge of a phone.
    if (granularity === "week") {
      const week = (start: string) => dates.plain(start, "dayMonth");
      return { axis: week, tooltip: week };
    }
    return {
      axis: (start) =>
        (granularity === "quarter" ? shortWithYear : short).format(
          parsePlainDate(start),
        ),
      tooltip: (start) => shortWithYear.format(parsePlainDate(start)),
    };
  }, [dates, granularity, short, shortWithYear]);
}

/**
 * Month names, in the reader's language.
 *
 * From `Intl` directly rather than through the reader's date *notation*: that
 * preference settles the order of a numeric date, and there is no order to
 * settle in "Apr". A calendar month named as a date — "Feb 1, 2026" — reads as
 * the first of the month rather than as the month, so anything naming a whole
 * month comes through here instead.
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
