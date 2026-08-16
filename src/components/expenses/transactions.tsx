"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { useNumberLocale } from "@/i18n/format-context";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Minus,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Amount, toneFor, type BalanceTone } from "@/components/money/amount";
import { formatMoney, money } from "@/modules/currencies/money";
import { UNCATEGORISED } from "@/modules/expenses/spread";
import { useCategoryLabel } from "@/components/expenses/category-field";
import {
  CATEGORY_GLYPHS,
  FALLBACK_GLYPH,
  hasGlyph,
  TYPE_GLYPHS,
} from "@/components/expenses/category-icon";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

/**
 * The transactions list, and the spread that filters it.
 *
 * One island rather than three, because the hero total, the chips, the bands
 * and the rows are four views of a single question — which categories are we
 * looking at — and splitting them would mean lifting that answer into a store
 * only to push it back down again.
 *
 * The answer lives in the URL. `useSearchParams` reads it and
 * `window.history.replaceState` writes it, which Next.js supports natively and
 * which costs no server round-trip. `replaceState`, not `pushState`: Back here
 * is a swipe that leaves the screen, and a gesture that undid a chip instead
 * of going back would be a worse trade than a filter that does not survive it.
 */

export interface BandView {
  readonly key: string;
  readonly categories: readonly string[];
  readonly total: string;
  /** Tenths of a percent, so the height and the printed figure agree. */
  readonly share: number;
  readonly rank: number | null;
}

export interface RowView {
  readonly kind: "expense" | "settlement";
  readonly id: string;
  readonly date: string;
  readonly createdAt: string;
  readonly title: string;
  readonly amount: string;
  readonly currency: string;
  /** The band key this row filters under; null for a settlement. */
  readonly category: string | null;
  /** Signed minor units, in the row's own currency; null when it is not ours. */
  readonly position: string | null;
  readonly revenue: boolean;
  readonly recurring: boolean;
}

export interface SpreadView {
  readonly currency: string;
  readonly total: string;
  readonly categories: number;
}

const FILTER_PARAM = "cat";
const QUERY_PARAM = "q";

/**
 * Ink for each band, chosen per theme rather than taken from the mock.
 *
 * The handoff specifies `--background` on every coloured band, which is right
 * in the dark theme it was drawn in and wrong in the light one: the light
 * palette's chart colours are far darker, and cream on `--chart-4` measures
 * 2.4:1. Each band therefore takes whichever of the two inks its own colour
 * can carry, and every pairing below clears 4.5:1 in both themes.
 */
const BAND_STYLES: readonly string[] = [
  "bg-chart-1 text-background",
  "bg-chart-2 text-foreground dark:text-background",
  "bg-chart-3 text-foreground dark:text-background",
  "bg-chart-4 text-foreground dark:text-background",
  "bg-chart-5 text-foreground",
];

/** The rail beside a row, in the colour of the band the row belongs to. */
const RAIL_STYLES: readonly string[] = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
];

const REMAINDER_STYLE = "bg-muted text-foreground";

const TONE_STYLES: Record<BalanceTone, string> = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-neutral-balance",
};

const TONE_ICONS: Record<BalanceTone, typeof ArrowDownLeft> = {
  positive: ArrowDownLeft,
  negative: ArrowUpRight,
  neutral: Minus,
};

const TONE_LABEL_KEYS = {
  positive: "positionBack",
  negative: "positionOwed",
  neutral: "positionSettled",
} as const;

/** The design's padded middots, which read as pauses rather than punctuation. */
const FACT_SEPARATOR = "  ·  ";

export function Transactions({
  groupId,
  eyebrow,
  bands,
  spreads,
  rows,
  repaid,
  backIn,
}: {
  groupId: string;
  eyebrow: ReactNode;
  /** Null when the group's spending spans more than one currency. */
  bands: readonly BandView[] | null;
  spreads: readonly SpreadView[];
  rows: readonly RowView[];
  repaid: readonly { currency: string; amount: string }[];
  backIn: readonly { currency: string; amount: string }[];
}) {
  const t = useTranslations("expensesList");
  const dates = useDateFormatter();
  const locale = useNumberLocale();
  const searchParams = useSearchParams();
  const categoryLabel = useCategoryLabel();

  const selected = searchParams.getAll(FILTER_PARAM);
  const query = searchParams.get(QUERY_PARAM) ?? "";

  /** Only keys that name a band today: a stale link narrows nothing. */
  const active = (bands ?? []).filter((band) => selected.includes(band.key));
  const isActive = (band: BandView) => selected.includes(band.key);

  const write = (next: URLSearchParams) => {
    const search = next.toString();
    window.history.replaceState(
      null,
      "",
      search ? `?${search}` : window.location.pathname,
    );
  };

  const toggleBand = (key: string) => {
    const next = new URLSearchParams(searchParams);
    const on = next.getAll(FILTER_PARAM);
    next.delete(FILTER_PARAM);
    const wanted = on.includes(key)
      ? on.filter((value) => value !== key)
      : [...on, key];
    for (const value of wanted) next.append(FILTER_PARAM, value);
    write(next);
  };

  const clearBands = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(FILTER_PARAM);
    write(next);
  };

  const setQuery = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(QUERY_PARAM, value);
    } else {
      next.delete(QUERY_PARAM);
    }
    write(next);
  };

  const nameOf = (category: string): string =>
    category === UNCATEGORISED
      ? t("uncategorised")
      : (categoryLabel(category) ?? t("uncategorised"));

  /** A band's label: its category, or the lead one and a count behind it. */
  const labelOf = (band: BandView): string => {
    const lead = nameOf(band.categories[0]);
    return band.categories.length > 1
      ? t("bandRemainder", { first: lead, count: band.categories.length - 1 })
      : lead;
  };

  const wanted =
    active.length === 0
      ? null
      : new Set(active.flatMap((band) => band.categories));
  const needle = query.trim().toLowerCase();

  const shown = rows.filter((row) => {
    if (wanted && (row.category === null || !wanted.has(row.category))) {
      return false;
    }
    if (needle === "") return true;
    const date = dates.plain(row.date);
    return `${row.title} ${date}`.toLowerCase().includes(needle);
  });

  /** Which colour a row's rail takes, from the band its category sits in. */
  const railOf = (category: string | null): string => {
    if (category === null || !bands) return "bg-border";
    const band = bands.find((band) => band.categories.includes(category));
    if (!band) return "bg-border";
    return band.rank === null ? "bg-muted" : RAIL_STYLES[band.rank - 1];
  };

  // Replayed on every filter change, because the list the reader is looking at
  // is a different list — the animation is what says so.
  const signature = active.map((band) => band.key).join("|") || "all";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        {eyebrow}
        <Hero
          active={active}
          spreads={spreads}
          repaid={repaid}
          backIn={backIn}
          shown={shown.length}
          total={rows.length}
          labelOf={labelOf}
        />
        {active.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {active.map((band) => (
              <li key={band.key}>
                <button
                  type="button"
                  onClick={() => toggleBand(band.key)}
                  aria-label={t("removeFilter", { category: labelOf(band) })}
                  className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-accent pr-1.5 pl-2.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                >
                  {labelOf(band)}
                  <X aria-hidden="true" className="size-[13px]" />
                </button>
              </li>
            ))}
            {active.length > 1 && (
              <li>
                <button
                  type="button"
                  onClick={clearBands}
                  className="inline-flex h-[26px] items-center rounded-full border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                >
                  {t("clearFilters")}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="flex gap-3.5">
        {bands && (
          <div
            role="group"
            aria-label={t("spreadLabel")}
            // A measured height, and it sticks: the spine is a proportion, and
            // a proportion drawn down the side of a list is only readable if
            // the whole of it is in view at once. Left to grow with the list it
            // would put a 79% band a thousand pixels tall next to a 3% one
            // nobody would ever scroll to.
            // `min-h-fit` is the guard on a short viewport: the bands have a
            // floor of their own, and the column growing past its measured
            // height is better than clipping the last one in half.
            className="sticky top-[4.5rem] flex h-[calc(100dvh-12rem)] max-h-[30rem] min-h-fit w-20 shrink-0 flex-col gap-[3px] self-start"
          >
            {bands.map((band) => {
              const dimmed = active.length > 0 && !isActive(band);
              return (
                <button
                  key={band.key}
                  type="button"
                  onClick={() => toggleBand(band.key)}
                  aria-pressed={isActive(band)}
                  aria-label={t("filterBy", { category: labelOf(band) })}
                  // The height is the share; the floor is what keeps a 1%
                  // category legible and tappable, and is also why the figure
                  // is printed on every band rather than read off its height.
                  style={{ flexGrow: band.share }}
                  className={cn(
                    // The floor is 60px rather than the mock's 46: its labels
                    // were hand-shortened ("Restaurants"), ours come from the
                    // catalogue in full ("Restaurants & Drinks") and wrap to a
                    // second line. 46px clipped the percentage — the one number
                    // the design says to compare bands by — off the bottom.
                    "flex min-h-[4.5rem] shrink-0 basis-0 flex-col items-start gap-px overflow-hidden rounded-md px-[7px] pt-[7px] pb-1 text-left transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
                    band.rank === null
                      ? REMAINDER_STYLE
                      : BAND_STYLES[band.rank - 1],
                    dimmed && "opacity-[0.28] saturate-50",
                    isActive(band) && "translate-x-[2px]",
                  )}
                >
                  <BandGlyph category={band.categories[0]} />
                  <span className="line-clamp-2 text-[0.65625rem] leading-[1.15] font-semibold tracking-[-0.01em]">
                    {labelOf(band)}
                  </span>
                  <span className="mt-px text-[0.65625rem] leading-none font-semibold tabular-nums opacity-70">
                    {formatShare(band.share, locale)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-[15px] -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("searchLabel")}
              placeholder={t("searchPlaceholder")}
              // The platform's own clear affordance is hidden: it sits where
              // ours does and only one of them tells the URL about it.
              className="h-[34px] rounded-xl pr-9 pl-[34px] text-base md:text-[0.8125rem] [&::-webkit-search-cancel-button]:hidden"
            />
            {query !== "" && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("clearSearch")}
                className="absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              >
                <X aria-hidden="true" className="size-[11px]" />
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-9 text-center">
              <p className="text-[0.84375rem] font-medium">
                {t("noMatchTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("noMatchHint")}
              </p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-[22px]">
              {shown.map((row, index) => (
                <li
                  key={`${row.kind}-${row.id}-${signature}`}
                  // Capped, so the last row of a long list is not still
                  // arriving when the reader has started scrolling.
                  style={{ animationDelay: `${Math.min(index * 24, 280)}ms` }}
                  className="animate-in duration-[260ms] ease-[cubic-bezier(0.2,0.7,0.3,1)] fill-mode-both fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
                >
                  <Row
                    row={row}
                    groupId={groupId}
                    rail={railOf(row.category)}
                    name={row.category === null ? null : nameOf(row.category)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The figure the screen opens with, and the facts under it.
 *
 * Filtered, it becomes the sum of what is selected. Unfiltered in a group that
 * spends in several currencies, it becomes one figure per currency — never
 * their sum, which would need a rate nobody chose.
 */
function Hero({
  active,
  spreads,
  repaid,
  backIn,
  shown,
  total,
  labelOf,
}: {
  active: readonly BandView[];
  spreads: readonly SpreadView[];
  repaid: readonly { currency: string; amount: string }[];
  backIn: readonly { currency: string; amount: string }[];
  shown: number;
  total: number;
  labelOf: (band: BandView) => string;
}) {
  const t = useTranslations("expensesList");
  const locale = useNumberLocale();
  const single = spreads.length === 1 ? spreads[0] : null;

  const formatted = (amount: string, currency: string) =>
    formatMoney(money(BigInt(amount), currency), { locale });

  if (!single) {
    // No single currency to total in, so the totals stand side by side and the
    // line underneath says why the spread is not there.
    return (
      <>
        <ul className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {spreads.map((spread) => (
            <li key={spread.currency} className="flex items-baseline gap-2">
              <Amount
                minorUnits={spread.total}
                currency={spread.currency}
                className="text-2xl leading-none font-semibold tracking-[-0.03em]"
              />
              <span className="text-[0.8125rem] font-medium text-muted-foreground">
                {t("spent")}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[0.78125rem] text-muted-foreground">
          {t("spreadNeedsOneCurrency", { count: spreads.length })}
        </p>
      </>
    );
  }

  if (active.length > 0) {
    const selected = active.reduce((sum, band) => sum + BigInt(band.total), 0n);
    return (
      <>
        <Figure minorUnits={selected.toString()} currency={single.currency} />
        <p className="text-[0.78125rem] text-muted-foreground">
          {[
            active.length === 1
              ? labelOf(active[0])
              : t("heroCategories", { count: active.length }),
            t("heroFiltered", { shown, total }),
          ].join(FACT_SEPARATOR)}
        </p>
      </>
    );
  }

  return (
    <>
      <Figure minorUnits={single.total} currency={single.currency} />
      <p className="text-[0.78125rem] text-muted-foreground">
        {[
          t("heroCategories", { count: single.categories }),
          ...repaid.map((entry) =>
            t("heroRepaid", {
              amount: formatted(entry.amount, entry.currency),
            }),
          ),
          ...backIn.map((entry) =>
            t("heroBackIn", {
              amount: formatted(entry.amount, entry.currency),
            }),
          ),
        ].join(FACT_SEPARATOR)}
      </p>
    </>
  );
}

function Figure({
  minorUnits,
  currency,
}: {
  minorUnits: string;
  currency: string;
}) {
  const t = useTranslations("expensesList");
  return (
    <p className="flex flex-wrap items-baseline gap-x-2.5">
      <Amount
        minorUnits={minorUnits}
        currency={currency}
        className="text-[2.5rem] leading-none font-semibold tracking-[-0.03em]"
      />
      <span className="text-[0.8125rem] font-medium text-muted-foreground">
        {t("spent")}
      </span>
    </p>
  );
}

function BandGlyph({ category }: { category: string }) {
  const Glyph = hasGlyph(category) ? CATEGORY_GLYPHS[category] : FALLBACK_GLYPH;
  return <Glyph aria-hidden="true" className="size-[15px] shrink-0" />;
}

function Row({
  row,
  groupId,
  rail,
  name,
}: {
  row: RowView;
  groupId: string;
  rail: string;
  name: string | null;
}) {
  const dates = useDateFormatter();
  const Glyph = hasGlyph(row.category)
    ? CATEGORY_GLYPHS[row.category]
    : FALLBACK_GLYPH;

  const badge = row.revenue
    ? ("revenue" as const)
    : row.kind === "settlement"
      ? ("settlement" as const)
      : row.recurring
        ? ("recurring" as const)
        : null;

  const body = (
    <>
      <span className={cn("h-[34px] w-[3px] shrink-0 rounded-sm", rail)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Glyph
            aria-hidden="true"
            className="size-[13px] shrink-0 text-muted-foreground"
          />
          {/* The category is named for a screen reader; a sighted reader has
              the glyph, and the rail matching the band it came from. */}
          {name && <span className="sr-only">{name}</span>}
          <span className="truncate text-sm font-medium">{row.title}</span>
        </span>
        <span className="mt-[3px] block truncate text-[0.71875rem] text-muted-foreground">
          {dates.plain(row.date)}
        </span>
        {badge && <TypeBadge kind={badge} />}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-[3px]">
        <Amount
          minorUnits={row.amount}
          currency={row.currency}
          signDisplay={row.revenue ? "always" : undefined}
          className={cn(
            "text-sm font-medium",
            row.kind === "settlement" && "text-muted-foreground",
          )}
        />
        {row.position !== null && (
          <Position
            minorUnits={row.position}
            currency={row.currency}
            // A repayment moves nobody's position; it closes one.
            tone={row.kind === "settlement" ? "neutral" : undefined}
          />
        )}
      </span>
      {row.kind === "expense" && (
        <ChevronRight
          aria-hidden="true"
          className="-ml-0.5 size-3.5 shrink-0 text-muted-foreground"
        />
      )}
    </>
  );

  // A settlement has no screen of its own to open yet, so it is not offered as
  // something to tap. Everything else opens its detail.
  if (row.kind === "settlement") {
    return (
      <span className="flex items-center gap-2.5 px-1.5 py-[7px]">{body}</span>
    );
  }

  return (
    <Link
      href={`/groups/${groupId}/expenses/${row.id}`}
      transitionTypes={PUSH}
      // A finger never hovers, so the row answers the press itself — every
      // other list in the app already does.
      className="-mx-1.5 -my-[7px] flex items-center gap-2.5 rounded-[10px] px-1.5 py-[7px] transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:bg-muted motion-reduce:transition-none"
    >
      {body}
    </Link>
  );
}

function TypeBadge({ kind }: { kind: "revenue" | "settlement" | "recurring" }) {
  const t = useTranslations("expensesList");
  const Glyph = TYPE_GLYPHS[kind];
  const label = t(
    kind === "revenue"
      ? "revenueBadge"
      : kind === "settlement"
        ? "paymentBadge"
        : "recurringBadge",
  );

  return (
    <span className="mt-[5px] flex">
      <span
        className={cn(
          "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-2 text-[0.65625rem] font-semibold",
          kind === "revenue" && "bg-positive/15 text-positive",
          kind === "settlement" && "border text-foreground",
          kind === "recurring" && "bg-accent text-accent-foreground",
        )}
      >
        <Glyph aria-hidden="true" className="size-[11px] shrink-0" />
        {label}
      </span>
    </span>
  );
}

/**
 * What the row left the reader holding.
 *
 * Three redundant cues, as everywhere else money carries a sign: the arrow,
 * the colour, and the word — hidden from the eye, not from a screen reader —
 * so the meaning survives greyscale and colour blindness.
 */
function Position({
  minorUnits,
  currency,
  tone,
}: {
  minorUnits: string;
  currency: string;
  tone?: BalanceTone;
}) {
  const t = useTranslations("expensesList");
  const resolved = tone ?? toneFor(minorUnits);
  const Icon = TONE_ICONS[resolved];
  const magnitude =
    BigInt(minorUnits) < 0n ? -BigInt(minorUnits) : BigInt(minorUnits);

  return (
    <span
      className={cn(
        "flex items-center gap-[3px] text-[0.6875rem] font-medium",
        TONE_STYLES[resolved],
      )}
    >
      <Icon aria-hidden="true" className="size-[11px] shrink-0" />
      <Amount minorUnits={magnitude.toString()} currency={currency} />
      <span className="sr-only">{t(TONE_LABEL_KEYS[resolved])}</span>
    </span>
  );
}

/**
 * A share reads as a whole number once it is big enough to round without
 * losing the comparison, and to a tenth below that — where 5.8% and 4.5%
 * would otherwise both print as "5%".
 */
function formatShare(share: number, locale: string): string {
  // Fixed either way, so a column of small bands reads 5.0 / 4.6 / 2.9 rather
  // than 5 / 4.6 / 2.9 — the decimal point is what lines the figures up.
  const places = share >= 100 ? 0 : 1;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(share / 1000);
}
