"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { useNumberLocale } from "@/i18n/format-context";
import { ChevronRight, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toneFor, type BalanceTone } from "@/components/money/balance-tone";
import { Amount } from "@/components/money/amount";
import { RANKED_BANDS, UNCATEGORISED } from "@/modules/expenses/spread";
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
 * One island rather than three, because the chips, the bands and the rows are
 * three views of a single question — which transactions are we looking at —
 * and splitting them would mean lifting that answer into a store only to push
 * it back down again. Three things narrow it: the kind chips, the category
 * spine, and the search field. They intersect; each one only ever takes rows
 * away.
 *
 * Nothing here summarises the result. The bands are already a picture of the
 * proportions, the rows are already the amounts, and a headline figure over
 * the top of both was a third telling of the same facts.
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
  readonly title: string;
  readonly amount: string;
  readonly currency: string;
  /** The band key this row filters under; null for a settlement. */
  readonly category: string | null;
  /**
   * What a repayment was for, when whoever recorded it said.
   *
   * An expense puts that in its title, so this is null on one: the description
   * *is* the row. A repayment's title is the two names, which are the fact
   * worth leading with — so its own words go on the line below, beside the
   * date, rather than displacing them.
   */
  readonly note: string | null;
  /** Signed minor units, in the row's display currency; null when it is not ours. */
  readonly position: string | null;
  readonly revenue: boolean;
  readonly recurring: boolean;
}

const FILTER_PARAM = "cat";
const QUERY_PARAM = "q";
const KIND_PARAM = "kind";

/**
 * The three things a row can be, in the order the chips stand in.
 *
 * Fixed rather than derived, so a group that has never recorded revenue still
 * puts Settlements on the right: the chip that is missing is removed, and the
 * ones that remain do not shuffle to fill the gap. A reader who learned where
 * a chip lives keeps it there when the group's contents change.
 */
const KINDS = ["expense", "revenue", "settlement"] as const;

export type EntryKind = (typeof KINDS)[number];

/** Income is stored as an expense running backwards, and filters as its own. */
function kindOf(row: RowView): EntryKind {
  if (row.kind === "settlement") return "settlement";
  return row.revenue ? "revenue" : "expense";
}

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
const BAND_MIN_HEIGHT = 72;
const BAND_GAP = 3;

/**
 * Fit as many named categories as the measured spine can carry.
 *
 * One slot is reserved for a remainder whenever every category cannot fit.
 * Totals, rather than already-rounded shares, are added so the remainder's
 * printed percentage stays exact.
 */
export function fitBandsToHeight(
  bands: readonly BandView[],
  height: number | null,
): BandView[] {
  const capacity =
    height === null
      ? RANKED_BANDS + 1
      : Math.max(
          2,
          Math.floor((height + BAND_GAP) / (BAND_MIN_HEIGHT + BAND_GAP)),
        );
  if (bands.length <= capacity) return [...bands];

  const visible = bands.slice(0, capacity - 1);
  const rest = bands.slice(capacity - 1);
  const grandTotal = bands.reduce((sum, band) => sum + BigInt(band.total), 0n);
  const restTotal = rest.reduce((sum, band) => sum + BigInt(band.total), 0n);
  const share =
    grandTotal === 0n
      ? 0
      : Number((restTotal * 2000n + grandTotal) / (grandTotal * 2n));

  return [
    ...visible,
    {
      key: rest[0].key,
      categories: rest.flatMap((band) => band.categories),
      total: restTotal.toString(),
      share,
      rank: null,
    },
  ];
}

const TONE_STYLES: Record<BalanceTone, string> = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-neutral-balance",
};

const TONE_SIGNS: Record<BalanceTone, string> = {
  positive: "+",
  negative: "−",
  neutral: "−",
};

const TONE_LABEL_KEYS = {
  positive: "positionBack",
  negative: "positionOwed",
  neutral: "positionSettled",
} as const;

export function Transactions({
  groupId,
  eyebrow,
  bands,
  kinds,
  rows,
  cursor,
}: {
  groupId: string;
  eyebrow: ReactNode;
  /** Null when the group's spending spans more than one currency. */
  bands: readonly BandView[] | null;
  /** Which kinds the group holds, measured over all of it — not over `rows`. */
  kinds: readonly EntryKind[];
  /** The first page. The rest arrive as the reader reaches the bottom. */
  rows: readonly RowView[];
  /** Where the first page ended; null when it was also the last. */
  cursor: string | null;
}) {
  const t = useTranslations("expensesList");
  const dates = useDateFormatter();
  const locale = useNumberLocale();
  const searchParams = useSearchParams();
  const categoryLabel = useCategoryLabel();
  const spineRef = useRef<HTMLDivElement>(null);
  const [spineHeight, setSpineHeight] = useState<number | null>(null);
  const visibleBands = bands ? fitBandsToHeight(bands, spineHeight) : null;

  useEffect(() => {
    const spine = spineRef.current;
    if (!spine) return;

    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.contentRect.height ?? 0;
      if (height > 0) setSpineHeight(height);
    });
    observer.observe(spine);
    return () => observer.disconnect();
  }, [bands]);

  const categoryOrder = bands?.flatMap((band) => band.categories) ?? [];
  const availableCategories = new Set(categoryOrder);
  const selected = new Set(
    searchParams
      .getAll(FILTER_PARAM)
      .filter((category) => availableCategories.has(category)),
  );
  const query = searchParams.get(QUERY_PARAM) ?? "";

  const isActive = (band: BandView) =>
    band.categories.every((category) => selected.has(category));
  const hasSelection = (band: BandView) =>
    band.categories.some((category) => selected.has(category));

  /*
   * Which chips exist is counted over everything the group has recorded, not
   * over what the search field or the spine has left standing. Counted over
   * the visible rows instead, the row would lose a chip the moment that chip
   * did its job — and searching would make chips appear and vanish under the
   * reader's thumb while they typed. It is counted on the server for the same
   * reason: the loaded rows are only the pages scrolled so far.
   */
  const present = KINDS.filter((kind) => kinds.includes(kind));
  const wantedKinds = new Set(
    searchParams
      .getAll(KIND_PARAM)
      .filter((kind): kind is EntryKind =>
        (present as readonly string[]).includes(kind),
      ),
  );

  const write = (next: URLSearchParams) => {
    const search = next.toString();
    window.history.replaceState(
      null,
      "",
      search ? `?${search}` : window.location.pathname,
    );
  };

  const toggleBand = (band: BandView) => {
    const next = new URLSearchParams(searchParams);
    next.delete(FILTER_PARAM);
    const wanted = new Set(selected);
    const remove = isActive(band);
    for (const category of band.categories) {
      if (remove) wanted.delete(category);
      else wanted.add(category);
    }
    for (const category of categoryOrder) {
      if (wanted.has(category)) next.append(FILTER_PARAM, category);
    }
    write(next);
  };

  /*
   * Several chips can be on at once, and each one widens what is shown rather
   * than replacing it — Expenses and Settlements together is a real question
   * ("what has actually moved?") that one-at-a-time chips cannot ask. None on
   * therefore means all, which is also what the last chip turning off returns
   * the reader to.
   */
  const toggleKind = (kind: EntryKind) => {
    const next = new URLSearchParams(searchParams);
    next.delete(KIND_PARAM);
    for (const value of KINDS) {
      const on = wantedKinds.has(value);
      if (value === kind ? !on : on) next.append(KIND_PARAM, value);
    }
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

  const wanted = selected.size === 0 ? null : selected;
  const needle = query.trim().toLowerCase();

  /*
   * A filter narrows the whole list, not the part of it that happens to be
   * loaded. Rows arrive a screenful at a time while the reader scrolls, but
   * the moment any filter is on, the rest of the history is fetched in bulk
   * behind it — otherwise a search for a 2019 hotel would come back empty on a
   * screen that simply had not read that far yet, which is a worse answer than
   * no search at all.
   */
  const filtering = wanted !== null || wantedKinds.size > 0 || needle !== "";
  const {
    rows: loaded,
    cursor: unread,
    busy,
    failed,
    retry,
    sentinelRef,
  } = usePages(groupId, rows, cursor, filtering);

  const shown = loaded.filter((row) => {
    if (wantedKinds.size > 0 && !wantedKinds.has(kindOf(row))) return false;
    if (wanted && (row.category === null || !wanted.has(row.category))) {
      return false;
    }
    if (needle === "") return true;
    const date = dates.plain(row.date);
    return `${row.title} ${row.note ?? ""} ${date}`
      .toLowerCase()
      .includes(needle);
  });

  /** Which colour a row's rail takes, from the band its category sits in. */
  const railOf = (category: string | null): string => {
    if (category === null || !visibleBands) return "bg-border";
    const band = visibleBands.find((band) =>
      band.categories.includes(category),
    );
    if (!band) return "bg-border";
    return band.rank === null ? "bg-muted" : RAIL_STYLES[band.rank - 1];
  };

  // Replayed on every filter change, because the list the reader is looking at
  // is a different list — the animation is what says so.
  const signature = [...selected, ...wantedKinds].join("|") || "all";

  return (
    <div className="flex flex-col gap-4">
      {eyebrow}

      {/* One chip per kind the group actually holds, and none at all when it
          holds only one: a row whose every chip says the same thing as the
          list underneath it is a control that can only be switched off. What
          is below simply moves up.

          Full width, above the spine rather than beside it: three labels do
          not fit the list's own column once the spine has taken its 80px, and
          the truncation that would follow lands on exactly the word that
          tells the chips apart. */}
      {present.length > 1 && (
        <div
          role="group"
          aria-label={t("kindFilterLabel")}
          className="flex gap-2"
        >
          {present.map((kind) => {
            const on = wantedKinds.has(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                aria-pressed={on}
                // Equal shares of the row, so the set reads as one control
                // rather than as a sentence of different lengths.
                className={cn(
                  "h-[34px] flex-1 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
                  on
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`kind_${kind}`)}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-3.5">
        {visibleBands && (
          <div
            ref={spineRef}
            role="group"
            aria-label={t("spreadLabel")}
            // It fills the viewport between the heading and bottom navigation,
            // and it sticks: the spine is a proportion, and
            // a proportion drawn down the side of a list is only readable if
            // the whole of it is in view at once. Left to grow with the list it
            // would put a 79% band a thousand pixels tall next to a 3% one
            // nobody would ever scroll to.
            // ResizeObserver groups enough lower categories into a remainder
            // to preserve every band's minimum readable, tappable height.
            className="sticky top-[4.5rem] flex h-[calc(100dvh-12rem)] w-20 shrink-0 flex-col gap-[3px] self-start overflow-hidden"
          >
            {visibleBands.map((band) => {
              const dimmed = selected.size > 0 && !hasSelection(band);
              return (
                <button
                  key={band.key}
                  type="button"
                  onClick={() => toggleBand(band)}
                  aria-pressed={isActive(band)}
                  // The band is the only way in and out of a category filter
                  // now that the chips below the total have gone, so it says
                  // which of the two a press would be.
                  aria-label={
                    isActive(band)
                      ? t("removeFilter", { category: labelOf(band) })
                      : t("filterBy", { category: labelOf(band) })
                  }
                  // The height is the share; the floor is what keeps a 1%
                  // category legible and tappable, and is also why the figure
                  // is printed on every band rather than read off its height.
                  style={{ flexGrow: band.share }}
                  className={cn(
                    // The floor is 72px rather than the mock's 46: its labels
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
                  <span className="line-clamp-2 text-2xs leading-[1.15] font-semibold tracking-[-0.01em]">
                    {labelOf(band)}
                  </span>
                  <span className="mt-px text-2xs leading-none font-semibold tabular-nums opacity-70">
                    {formatShare(band.share, locale)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* One chip per kind the group actually holds, and none at all when
              it holds only one: a row whose every chip says the same thing as
              the list underneath it is a control that can only be switched
              off. The search field takes the space back. */}
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
              className="h-[34px] rounded-xl pr-9 pl-[34px] text-base md:text-xs [&::-webkit-search-cancel-button]:hidden"
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

          {/* "Nothing matches" is only true once there is nothing left to
              read. Said while pages are still arriving it would be a verdict
              on a search that has not finished — and it would flash up on
              every filter that has to reach back a few pages. */}
          {shown.length === 0 && unread === null ? (
            <div className="flex flex-col items-center gap-2 px-4 py-9 text-center">
              <p className="text-sm font-medium">{t("noMatchTitle")}</p>
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

          {/* Always mounted, so the observer watching it never has to be
              rebuilt, and empty whenever there is nothing to say. */}
          <div ref={sentinelRef} className="pt-6 empty:pt-0">
            {failed ? (
              <div className="flex flex-col items-center gap-1.5 text-center">
                <p className="text-sm text-muted-foreground">
                  {t("loadFailed")}
                </p>
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-md px-2 py-1 text-sm font-semibold underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {t("loadRetry")}
                </button>
              </div>
            ) : busy ? (
              <p
                role="status"
                className="text-center text-xs text-muted-foreground"
              >
                {filtering ? t("searchingEarlier") : t("loadingEarlier")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Rows fetched at once when a filter is on.
 *
 * Large enough that reaching 2019 from 2026 is a handful of requests rather
 * than a hundred, and capped again on the server, which is where the real
 * limit belongs.
 */
const BULK_PAGE_SIZE = 500;

interface PageResponse {
  readonly rows: readonly RowView[];
  readonly cursor: string | null;
}

interface Paging {
  readonly rows: readonly RowView[];
  /** Null once the whole list has been read. */
  readonly cursor: string | null;
  /** A page is on its way, or is about to be. */
  readonly busy: boolean;
  readonly failed: boolean;
  readonly retry: () => void;
  readonly sentinelRef: RefObject<HTMLDivElement | null>;
}

/**
 * The rest of the list, fetched as the reader needs it.
 *
 * Two things ask for a page: the sentinel below the list coming into view, and
 * a filter being on — the first a screenful at a time, the second in bulk
 * until the list runs out. Both go through one request at a time, because the
 * cursor for the next page is only known once the current one has landed.
 *
 * There is no `loading` flag, because there is nothing for one to remember.
 * Wanting more rows and there being more to give is the whole condition, and
 * both halves are already state: a request is in the air whenever `busy` says
 * it should be. A separate flag would only be a second copy of that, kept in
 * step by hand.
 *
 * A failure stops the loop rather than retrying by itself. A list that
 * silently re-requested a failing endpoint every time the reader nudged the
 * scrollbar would be a worse thing to be sitting under than a sentence saying
 * so and a button.
 */
function usePages(
  groupId: string,
  first: readonly RowView[],
  firstCursor: string | null,
  eager: boolean,
): Paging {
  const [state, setState] = useState({
    first,
    rows: first,
    cursor: firstCursor,
  });
  const [failed, setFailed] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const inFlight = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /*
   * The server sent a different first page — something was added, edited or
   * deleted and the route revalidated — so every page read after it describes
   * a list that no longer exists. Start again from what it just sent.
   *
   * Adjusted during render rather than in an effect: React re-runs the
   * component immediately with the new state and before anything paints, so
   * the stale rows never reach the screen.
   */
  if (state.first !== first) {
    setState({ first, rows: first, cursor: firstCursor });
    setFailed(false);
  }

  const { cursor } = state;
  const busy = cursor !== null && !failed && (eager || atEnd);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    // Watched well before it is actually reached, so the next rows are already
    // in place by the time the reader gets to the bottom rather than starting
    // to be fetched then.
    const observer = new IntersectionObserver(
      ([entry]) => setAtEnd(entry?.isIntersecting ?? false),
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!busy || cursor === null || inFlight.current) return;
    inFlight.current = true;
    const from = cursor;

    void (async () => {
      try {
        const params = new URLSearchParams({ cursor: from });
        if (eager) params.set("limit", String(BULK_PAGE_SIZE));
        const response = await fetch(
          `/api/groups/${groupId}/transactions?${params}`,
          { headers: { Accept: "application/json" } },
        );
        if (!response.ok) throw new Error(`Transactions: ${response.status}`);
        const page = (await response.json()) as PageResponse;
        setState((prev) =>
          // Not the page we were reading any more: the list reset underneath
          // this request while it was in the air, and these rows belong to the
          // list it replaced.
          prev.cursor === from
            ? {
                first: prev.first,
                rows: [...prev.rows, ...page.rows],
                cursor: page.cursor,
              }
            : prev,
        );
      } catch {
        setFailed(true);
      } finally {
        inFlight.current = false;
      }
    })();
  }, [busy, cursor, eager, groupId]);

  const retry = useCallback(() => setFailed(false), []);

  return { rows: state.rows, cursor, busy, failed, retry, sentinelRef };
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
        <span className="mt-[3px] block truncate text-2xs text-muted-foreground">
          {row.note
            ? `${dates.plain(row.date)} · ${row.note}`
            : dates.plain(row.date)}
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
      <ChevronRight
        aria-hidden="true"
        className="-ml-0.5 size-3.5 shrink-0 text-muted-foreground"
      />
    </>
  );

  return (
    <Link
      // Every row opens its own detail screen, repayments included: the one
      // thing this row cannot say about a repayment is whether it finished the
      // job, and that is the whole of what the screen behind it is for.
      href={
        row.kind === "settlement"
          ? `/groups/${groupId}/settlements/${row.id}`
          : `/groups/${groupId}/expenses/${row.id}`
      }
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
          "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-2 text-2xs font-semibold",
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
 * Three redundant cues, as everywhere else money carries a sign: the sign,
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
  const sign = TONE_SIGNS[resolved];
  const magnitude =
    BigInt(minorUnits) < 0n ? -BigInt(minorUnits) : BigInt(minorUnits);

  return (
    <span
      className={cn(
        "flex items-center gap-[3px] text-2xs font-medium",
        TONE_STYLES[resolved],
      )}
    >
      <span
        aria-hidden="true"
        className="w-[11px] shrink-0 text-center leading-none font-semibold"
      >
        {sign}
      </span>
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
