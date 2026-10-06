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
// Aliased: `ListFilter` is also the name of the object it opens.
import {
  ChevronRight,
  ListFilter as FilterGlyph,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Amount } from "@/components/money/amount";
import { RANKED_BANDS, UNCATEGORISED } from "@/modules/expenses/spread";
import { useCategoryLabel } from "@/components/expenses/category-field";
import {
  CATEGORY_GLYPHS,
  FALLBACK_GLYPH,
  hasGlyph,
} from "@/components/expenses/category-icon";
import type { EntryMember } from "@/components/entries/pills";
import type { ExpenseCategory } from "@/modules/categorization";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";
import { listQuery, withQuery } from "./list-query";
import {
  filterDimensions,
  filterParams,
  kindOf,
  KINDS,
  NO_FILTER,
  readFilter,
  searchNeedle,
  selectRows,
  type EntryKind,
  type ListFilter,
  type RowView,
} from "./list-filter";
import { FilterSheet } from "./filter-sheet";
import { FilterRow } from "./filter-row";
import { badgeOf, Position, TypeBadge } from "./row-parts";
import { SwipeToDelete } from "./swipe-to-delete";
import { TransactionsTable, useDeskWidth } from "./transactions-table";
import { forgetPlace, readPlace, rememberPlace } from "./list-place";

/**
 * The transactions list, and the spread that filters it.
 *
 * One island rather than four, because the chips, the bands, the sheet and the
 * rows are four views of a single question — which transactions are we looking
 * at — and splitting them would mean lifting that answer into a store only to
 * push it back down again. Four things narrow it: the kind chips, the category
 * spine, the search field, and the filter sheet behind the button beside it.
 * They intersect; each one only ever takes rows away.
 *
 * Type and Category have two controls each — the chip row and the sheet, the
 * spine and the sheet — and one piece of state. Selecting Groceries in the
 * sheet lights that band because there is nowhere else for it to be recorded;
 * a chip row reading `Expenses` while the sheet held `Settlements` is the bug
 * this shape makes unwritable.
 *
 * What rows a filter leaves standing is not decided here. `list-filter.ts` has
 * the only predicate, so the sheet's apply button can promise a number the
 * list is bound to honour.
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
 *
 * ## Leaving, and coming back
 *
 * Opening a row is a round trip, and the reader expects to be put back down
 * where they were picked up — same filters, same place in the list. The
 * filters go with them, on the link out and on the detail screen's link home,
 * because they are already a query string and `list-query.ts` is where the
 * three of them are named. What cannot travel that way — how much of the list
 * had been read in, and how far down it the reader was — is remembered for the
 * length of the trip in `list-place.ts` and spent on arrival.
 *
 * ## Two renderers, one list
 *
 * From `lg` up the rows are drawn as a table, `TransactionsTable`, and the
 * chips, the spine and the search row give way to one row of filters,
 * `FilterRow`. Only the drawing forks. The filter, the paging, the place kept
 * across a round trip, the sheet and the sentinel that asks for the next page
 * are this component's and are shared by both: the table is handed the very
 * rows the list would have drawn. The sentinel stays in one place in the tree
 * for that reason — the observer watching it is set up once, and must not lose
 * it when the window crosses `lg` and one renderer gives way to the other.
 */

export interface BandView {
  readonly key: string;
  readonly categories: readonly string[];
  readonly total: string;
  /** Tenths of a percent, so the height and the printed figure agree. */
  readonly share: number;
  readonly rank: number | null;
}

export type { EntryKind, RowView };

/**
 * Ink for each band, chosen per theme rather than taken from the mock.
 *
 * The handoff specifies `--background` on every coloured band, which is right
 * in the dark theme it was drawn in and wrong in the light one: the light
 * palette's chart colours are darker, and cream on the teal `--chart-3` or
 * the slate `--chart-4` falls well short. Each band therefore takes whichever
 * of the two inks its own colour can carry. `--chart-2` is the accent — the
 * "you" series — so its band has to read under plum in all seven accents,
 * which it does; `src/app/token-contrast.test.ts` holds every pairing below
 * to 4.5:1 in both themes.
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
 *
 * `extent` is whichever axis the spine runs along: its height at the desk,
 * where it stands beside the list, and its width on a phone, where it lies
 * above it. A band's minimum is the same 72px either way — it is the size of
 * the label and the percentage inside it, which do not care which direction
 * the bands are laid out in — so the only thing that changes is what gets
 * measured. The name stays `fitBandsToHeight` because that is what the desk
 * case is and what its tests call.
 */
export function fitBandsToHeight(
  bands: readonly BandView[],
  extent: number | null,
  minimum: number = BAND_MIN_HEIGHT,
): BandView[] {
  const capacity =
    extent === null
      ? RANKED_BANDS + 1
      : Math.max(2, Math.floor((extent + BAND_GAP) / (minimum + BAND_GAP)));
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

export function Transactions({
  groupId,
  eyebrow,
  bands,
  kinds,
  rows,
  cursor,
  members,
  used,
  counts,
  byAmount,
  firstDate,
  today,
  self = null,
  total = null,
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
  /** Everyone in the group, for the sheet's Paid by chips. */
  members: readonly EntryMember[];
  /** The categories the group has filed something under, in taxonomy order. */
  used: readonly ExpenseCategory[];
  /** Transactions per category, counted over the whole group. */
  counts: Readonly<Record<string, number>>;
  /**
   * Whether every row the group holds is listed in one currency, so that
   * `Largest amount` ranks something. Measured over the whole group.
   */
  byAmount: boolean;
  /** The group's earliest transaction date; null when it has none. */
  firstDate: string | null;
  /** Today, in the group's timezone. */
  today: string;
  /** The reader's participant id, so the table can say "You" for them. */
  self?: string | null;
  /**
   * How many transactions the group holds, counted on the server — the "of
   * 42" the table's footer reads before any filter narrows it.
   */
  total?: number | null;
}) {
  const t = useTranslations("expensesList");
  const dates = useDateFormatter();
  const locale = useNumberLocale();
  const searchParams = useSearchParams();
  const categoryLabel = useCategoryLabel();
  /*
   * Which renderer the window can see: the phone's list below `lg`, the table
   * from it. Unknown on the server and through hydration, when both are drawn
   * and CSS shows one — see `useDeskWidth`.
   */
  const desk = useDeskWidth();
  const showList = desk !== true;
  const showTable = desk !== false;
  const spineRef = useRef<HTMLDivElement>(null);
  /*
   * However long the spine is along the axis it actually runs on.
   *
   * It runs down the side of the list at the desk and across the top of it on
   * a phone, so the measurement follows the layout rather than assuming the
   * height. Both come off the same `contentRect`, and the element's own shape
   * says which one to read: a spine wider than it is tall is lying down.
   */
  const [spineExtent, setSpineExtent] = useState<number | null>(null);
  const visibleBands = bands ? fitBandsToHeight(bands, spineExtent) : null;

  useEffect(() => {
    const spine = spineRef.current;
    if (!spine) return;

    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box) return;
      const extent = box.width > box.height ? box.width : box.height;
      if (extent > 0) setSpineExtent(extent);
    });
    observer.observe(spine);
    return () => observer.disconnect();
    // `showList` too: a window narrowed past `lg` mounts a new spine, and the
    // one the observer was watching has gone with the table's arrival.
  }, [bands, showList]);

  /*
   * Which chips exist is counted over everything the group has recorded, not
   * over what the search field or the spine has left standing. Counted over
   * the visible rows instead, the row would lose a chip the moment that chip
   * did its job — and searching would make chips appear and vanish under the
   * reader's thumb while they typed. It is counted on the server for the same
   * reason: the loaded rows are only the pages scrolled so far.
   */
  const present = KINDS.filter((kind) => kinds.includes(kind));

  /*
   * What the list is showing, read from the URL on every render.
   *
   * One object rather than four reads, because four controls write it: the
   * spine, the chip row, the search field and the sheet. Whichever one moves,
   * every other one is looking at the result a render later — which is what
   * makes "selecting Groceries in the sheet lights that band" true without
   * anything being kept in step by hand.
   *
   * A kind this group cannot show is dropped rather than obeyed. A link built
   * in a group that records revenue must not arrive in one that does not and
   * empty the list against a chip that is not even on the screen to turn off.
   * Categories are not narrowed the same way: filtering on one the group has
   * never used is a question the sheet deliberately lets you ask.
   */
  const requested = readFilter(searchParams);
  const applied: ListFilter = {
    ...requested,
    kinds: present.filter((kind) => requested.kinds.includes(kind)),
  };
  const selected = new Set(applied.categories);
  const wantedKinds = new Set(applied.kinds);

  /** The filters as one string, which is what a link out carries. */
  const filterQuery = listQuery(searchParams);

  const isActive = (band: BandView) =>
    band.categories.every((category) => selected.has(category));
  const hasSelection = (band: BandView) =>
    band.categories.some((category) => selected.has(category));

  const write = (next: ListFilter) => {
    const search = filterParams(
      next,
      new URLSearchParams(searchParams),
    ).toString();
    window.history.replaceState(
      null,
      "",
      search ? `?${search}` : window.location.pathname,
    );
  };

  /*
   * A band covers one or more categories, and pressing it takes all of them —
   * but only those. Whatever else is selected is left alone, including the
   * subcategory pairs the sheet writes, which no band has any opinion about.
   */
  const toggleBand = (band: BandView) => {
    const remove = isActive(band);
    const wanted = new Set(selected);
    for (const category of band.categories) {
      if (remove) wanted.delete(category);
      else wanted.add(category);
    }
    write({ ...applied, categories: [...wanted] });
  };

  /*
   * Several chips can be on at once, and each one widens what is shown rather
   * than replacing it — Expenses and Settlements together is a real question
   * ("what has actually moved?") that one-at-a-time chips cannot ask. None on
   * therefore means all, which is also what the last chip turning off returns
   * the reader to.
   *
   * Every chip on means all as well, and that was the bug: the two states
   * produced an identical list while looking like opposites. Arriving at the
   * screen, both chips sat unpressed and the list showed everything; pressing
   * both lit them coral and the list showed exactly the same thing, with
   * `?kind=expense&kind=settlement` in the address bar to prove it was a
   * different state. There was no way to tell from the screen which of the two
   * you were in, and no reason for the reader to care.
   *
   * So the full set is written as the empty one, and the row has a single
   * resting state again: nothing lit means nothing is being filtered out.
   * Every genuinely narrowing combination is still reachable, which is why
   * this is not the segmented All / Expenses / Repayments it looks like it
   * wants to be — that would have cost the group holding all three kinds the
   * ability to ask for two of them.
   */
  const toggleKind = (kind: EntryKind) => {
    const on = wantedKinds.has(kind);
    const next = KINDS.filter((value) =>
      value === kind ? !on : wantedKinds.has(value),
    );
    write({
      ...applied,
      kinds: next.length === present.length ? [] : next,
    });
  };

  const setQuery = (value: string) => write({ ...applied, query: value });

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

  /*
   * The sheet, and the draft it is editing.
   *
   * The draft is held here rather than in the sheet because the apply button
   * previews the outcome — `Show 4 transactions` — and that number has to be
   * counted the same way the list is filtered: here, over the rows in hand,
   * when those are the whole group, and by the endpoint the filtered pages
   * come from when they are not. Owned by the sheet, it would be a second
   * answer to the question the list is already answering, and the two would
   * eventually differ.
   *
   * Open is separate from it, and the draft is not cleared on closing, so the
   * sheet has something to draw while it slides back down. Nothing survives
   * the trip: opening writes the applied filters over whatever was there,
   * which is what "closing without applying discards the draft" amounts to.
   */
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ListFilter>(NO_FILTER);

  /*
   * A filter narrows the whole list, not the part of it that happens to be
   * loaded — a search for a 2019 hotel must not come back empty on a screen
   * that simply had not read that far yet, which is a worse answer than no
   * search at all.
   *
   * It used to get there by fetching the rest of the history in bulk the
   * moment any filter was on, five hundred rows a request, and filtering it
   * here: the first letter typed into the search field downloaded the group's
   * whole past to the phone and rendered every match at once. Now the filter
   * travels to the server instead, and comes back as pages of matches that
   * arrive a screenful at a time like any other — see `usePages`.
   */
  const filtering =
    searchNeedle(applied) !== "" || filterDimensions(applied) > 0;

  /*
   * The place the reader left from, read on the first render because the
   * number of rows to fetch depends on it — and only there, so that the record
   * outlives being erased a moment later.
   */
  const [stored] = useState(() =>
    typeof window === "undefined" ? null : readPlace(groupId),
  );

  useEffect(forgetPlace, []);

  /*
   * It is only a place in *this* list if the filters are the ones that drew
   * it. Compared every render rather than once, because the first render of a
   * client component is not always the one that knows what is in the URL — and
   * because a chip pressed afterwards makes it a different list, at which
   * point there is nothing left to go back to.
   */
  const place =
    stored !== null && stored.search === filterQuery ? stored : null;

  /*
   * While the place stands the list holds itself at least that long. That also
   * covers the server sending a fresh first page from under the reader — a
   * list that snapped back to forty rows would take their position with it.
   */
  const paging = usePages(
    groupId,
    rows,
    cursor,
    filtering ? filterParams(applied).toString() : "",
    place?.rows ?? 0,
  );
  const {
    rows: loaded,
    cursor: unread,
    busy,
    failed,
    retry,
    sentinelRef,
  } = paging;

  /*
   * Back down to where they were, once there is enough list to stand on.
   *
   * Held until the rows the offset was measured against are actually in the
   * DOM: scrolling to 4000px on a page 900px tall does nothing at all, and the
   * browser does not remember that you asked. Given up on — rather than waited
   * out — when the list has ended or the fetch has failed, because as far down
   * as we can get is a better answer than the top of the screen.
   */
  const restored = useRef(false);

  useEffect(() => {
    if (place === null || restored.current) return;
    if (loaded.length < place.rows && unread !== null && !failed) return;
    restored.current = true;
    // Instant, not smooth: this is not a journey the reader took, it is the
    // undoing of one they never asked to make.
    window.scrollTo({ top: place.scrollY, behavior: "instant" });
  }, [place, loaded.length, unread, failed]);

  /** Remember the place, on the way into an entry's own screen. */
  const remember = () => {
    rememberPlace(groupId, {
      rows: loaded.length,
      scrollY: window.scrollY,
      search: filterQuery,
    });
  };

  /*
   * What is on screen, and what the sheet is promising.
   *
   * When the rows in hand are the whole group, the one predicate runs over
   * them twice, here, and no request is made at all — most groups fit in the
   * first page, and a filter there is as instant as it always was. When they
   * are not, the list is the server's pages of matches, and the count is the
   * server's too.
   *
   * Until a filtered list's first page lands, the rows in hand stand in for
   * it: newest first, the matches among the newest rows read are exactly the
   * start of the answer, so the list fills in rather than blanking and
   * reappearing under every keystroke. The same rows are what a reader with
   * no connection is left with, and the failure line under them says that is
   * all there is.
   */
  const context = { today, dateText: dates.plain };
  const shown =
    paging.narrowed === null
      ? selectRows(loaded, applied, context)
      : paging.narrowed.started
        ? paging.narrowed.rows
        : applied.sort === "newest" || failed
          ? selectRows(paging.base, applied, context)
          : [];
  const draftQuery = filterParams(draft).toString();
  const counted = useCount(groupId, draftQuery, open && !paging.complete);
  // Counted even while the sheet is shut, so the button it is pinned to does
  // not change its mind about what it was promising on the way down. Null
  // while the server is still counting, or cannot be reached, and the button
  // then promises the list without a number rather than a number it has not
  // got.
  const preview = paging.complete
    ? selectRows(paging.base, draft, context).length
    : counted;

  /*
   * The "of 42" under the table. The rows in hand once they are the whole
   * group, since then they are the exact answer; the group's own count, from
   * the server, while nothing narrows a list still being read; and the
   * server's count of a filter the rows in hand cannot answer — asked only
   * where a table is drawn, because the phone's list has no footer to say it
   * in. Null while nobody knows, and the footer then says what it is showing
   * without claiming a total.
   */
  const countedApplied = useCount(
    groupId,
    filterParams(applied).toString(),
    showTable && filtering && !paging.complete,
  );
  const listTotal = paging.complete
    ? shown.length
    : filtering
      ? countedApplied
      : total;

  /** Opens the sheet on the list the reader is looking at. */
  const openSheet = () => {
    setDraft(applied);
    setOpen(true);
  };

  /** Which colour a row's rail takes, from the band its category sits in. */
  const railOf = (category: string | null): string => {
    if (category === null || !visibleBands) return "bg-border";
    const band = visibleBands.find((band) =>
      band.categories.includes(category),
    );
    if (!band) return "bg-border";
    return band.rank === null ? "bg-muted" : RAIL_STYLES[band.rank - 1];
  };

  /*
   * Replayed on every filter change, because the list the reader is looking at
   * is a different list — the animation is what says so.
   *
   * The search field is left out. It changes on every keystroke, and a list
   * that re-entered under the reader's thumb as they typed would be motion
   * for its own sake.
   */
  const signature = filterParams({ ...applied, query: "" }).toString() || "all";

  return (
    // `data-layout="wide"` asks the screen around this for the room a table
    // needs from `lg` up, as the overview's two columns do. Below `lg` it
    // changes nothing: the screen only reads it from there.
    <div data-layout="wide" className="flex flex-col gap-4">
      {eyebrow}

      {/* One chip per kind the group actually holds, and none at all when it
          holds only one: a row whose every chip says the same thing as the
          list underneath it is a control that can only be switched off. What
          is below simply moves up.

          Full width, and above the spine rather than beside it. Three labels
          have never fitted the list's own column at the desk, where the spine
          stands in 80px of it, and the truncation that would follow lands on
          exactly the word that tells the chips apart.

          From `lg` up the same chips stand in the table's filter row. */}
      {showList && present.length > 1 && (
        <div
          role="group"
          aria-label={t("kindFilterLabel")}
          className="flex gap-2 lg:hidden"
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
                  "tap-target h-[34px] flex-1 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
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

      {/* Column on a phone, row at the desk — which is what puts the spine
          above the list in the hand and beside it on a screen. */}
      <div className="flex flex-col gap-3.5 md:flex-row">
        {showList && visibleBands && (
          <div
            ref={spineRef}
            role="group"
            aria-label={t("spreadLabel")}
            /*
             * At the desk it fills the viewport between the heading and the
             * bottom navigation, and it sticks: the spine is a proportion, and
             * a proportion drawn down the side of a list is only readable if
             * the whole of it is in view at once. Left to grow with the list it
             * would put a 79% band a thousand pixels tall next to a 3% one
             * nobody would ever scroll to.
             *
             * On a phone it lies down instead, and that is not a preference.
             * Standing, it took `w-20` — 80px of a 375px screen, 21% of the
             * width, sticky for the whole scroll — and the list paid for it out
             * of the only column it had: with 261px left, three of five
             * transactions truncated, "Courses de la semaine" losing 35% of its
             * name to show a chart that said "Maison 96%". A 96/4 split is the
             * case where a proportion tells the reader least, and it was
             * costing the most contested space on the screen to tell them.
             *
             * Lying down it is 72px tall — one band's own minimum, so nothing
             * inside it is redrawn — and the list gets the full width back.
             *
             * ResizeObserver groups enough lower categories into a remainder to
             * preserve every band's minimum readable, tappable size along
             * whichever axis it is running on.
             *
             * From `lg` up it is not drawn. The rows stand in a table there,
             * and a table has a Category column that says the same thing row
             * by row; the filter it was is the Category menu in `FilterRow`.
             */
            className="flex h-[4.5rem] w-full shrink-0 flex-row gap-[3px] overflow-hidden md:sticky md:top-[4.5rem] md:h-[calc(100dvh-12rem)] md:w-20 md:flex-col md:self-start lg:hidden"
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
                    //
                    // The same 72px is the floor on the other axis when the
                    // spine lies down on a phone: the box holding a two-line
                    // label and a percentage is the same box whichever way the
                    // bands are stacked.
                    "flex min-w-[4.5rem] shrink-0 basis-0 flex-col items-start gap-px overflow-hidden rounded-md px-[7px] pt-[7px] pb-1 text-left transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none md:min-h-[4.5rem] md:min-w-0",
                    band.rank === null
                      ? REMAINDER_STYLE
                      : BAND_STYLES[band.rank - 1],
                    dimmed && "opacity-[0.28] saturate-50",
                    // A picked band leans towards the list it is filtering,
                    // which is downwards on a phone and sideways at the desk.
                    isActive(band) &&
                      "translate-y-[2px] md:translate-x-[2px] md:translate-y-0",
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
          {/* The search field, and beside it the way in to everything it
              cannot ask. The button does not join the chip row above: every
              control in that row is one of the kinds a row can be, and a
              button that opens a sheet is not one of them. */}
          {showList && (
            <div className="flex items-center gap-2 lg:hidden">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-[15px] -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={applied.query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={t("searchLabel")}
                  placeholder={t("searchPlaceholder")}
                  // The platform's own clear affordance is hidden: it sits where
                  // ours does and only one of them tells the URL about it.
                  className="h-[34px] rounded-xl pr-9 pl-[34px] text-base md:text-xs [&::-webkit-search-cancel-button]:hidden"
                />
                {applied.query !== "" && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label={t("clearSearch")}
                    className="tap-target absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                  >
                    <X aria-hidden="true" className="size-[11px]" />
                  </button>
                )}
              </div>
              <FilterButton
                count={filterDimensions(applied)}
                // The draft starts as what is already applied, so the sheet
                // opens showing the list the reader is looking at.
                onClick={openSheet}
              />
            </div>
          )}

          {showTable && (
            <FilterRow
              className="hidden lg:flex"
              applied={applied}
              onChange={write}
              present={present}
              onToggleKind={toggleKind}
              used={used}
              counts={counts}
              firstDate={firstDate}
              today={today}
              nameOf={nameOf}
              // What the sheet holds that the row cannot show: the kinds, the
              // category and the period are on the row already, and the order
              // is on the table's header. A badge counting them again would
              // say the list is narrower than it is.
              moreCount={filterDimensions({
                ...applied,
                kinds: [],
                categories: [],
                subcategories: [],
                when: "any",
                sort: "newest",
              })}
              onMore={openSheet}
              groupId={groupId}
            />
          )}

          {/* "Nothing matches" is only true once there is nothing left to
              read. Said while pages are still arriving it would be a verdict
              on a search that has not finished — and it would flash up on
              every filter that has to reach back a few pages. */}
          {!showList ? null : shown.length === 0 && unread === null ? (
            <div className="flex flex-col items-center gap-2 px-4 py-9 text-center lg:hidden">
              <p className="text-sm font-medium">{t("noMatchTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("noMatchHint")}
              </p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-[22px] lg:hidden">
              {shown.map((row, index) => (
                <li
                  key={`${row.kind}-${row.id}-${signature}`}
                  // Capped, so the last row of a long list is not still
                  // arriving when the reader has started scrolling.
                  style={{ animationDelay: `${Math.min(index * 24, 280)}ms` }}
                  className="animate-in duration-[260ms] ease-[cubic-bezier(0.2,0.7,0.3,1)] fill-mode-both fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
                >
                  <SwipeToDelete
                    groupId={groupId}
                    kind={row.kind}
                    id={row.id}
                    description={row.title}
                  >
                    <Row
                      row={row}
                      groupId={groupId}
                      rail={railOf(row.category)}
                      name={row.category === null ? null : nameOf(row.category)}
                      query={filterQuery}
                      onOpen={remember}
                    />
                  </SwipeToDelete>
                </li>
              ))}
            </ul>
          )}

          {showTable && (
            <div className="hidden lg:block">
              <TransactionsTable
                rows={shown}
                groupId={groupId}
                query={filterQuery}
                onOpen={remember}
                self={self}
                members={members}
                today={today}
                sort={applied.sort}
                // The same rule the sheet's Sort section follows.
                byAmount={byAmount}
                onSort={(sort) => write({ ...applied, sort })}
                total={listTotal}
                more={unread !== null}
                nameOf={nameOf}
              />
            </div>
          )}

          {/* Always mounted, so the observer watching it never has to be
              rebuilt, and empty whenever there is nothing to say. Shared by
              both renderers for the same reason: it is the one element the
              observer was given, whichever of them is on screen. */}
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

      <FilterSheet
        open={open}
        onOpenChange={setOpen}
        draft={draft}
        onDraftChange={setDraft}
        onApply={() => {
          write(draft);
          setOpen(false);
        }}
        count={preview}
        kinds={present}
        members={members}
        used={used}
        counts={counts}
        firstDate={firstDate}
        today={today}
        byAmount={byAmount}
      />
    </div>
  );
}

/**
 * The way in to the sheet, and the only thing on the screen that can say the
 * list is narrower than it looks.
 *
 * The badge counts dimensions in use, not matching rows and not chips: three
 * categories inside one section is one filter. A list that is filtered but
 * looks unfiltered is the failure this button exists to prevent, so the count
 * is never the thing that makes it look busier than the filtering warrants.
 */
function FilterButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const t = useTranslations("expensesList.filters");
  const on = count > 0;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onClick}
        aria-label={on ? t("openWith", { count }) : t("open")}
        // 34px square, sharing the search field's height and its border, so
        // the two read as one row rather than as a field and a decoration.
        className={cn(
          "tap-target grid size-[34px] place-items-center rounded-xl border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
          // The coral the mock draws the icon in measures 2.6:1 against the
          // light background and 5.6:1 against the dark one, so the light
          // theme takes the ink it can read. The border and the tint are what
          // carry the colour there, and the badge is what carries the count.
          on
            ? "border-primary bg-primary/15 text-foreground dark:text-primary"
            : "border-input text-muted-foreground hover:text-foreground",
        )}
      >
        <FilterGlyph aria-hidden="true" className="size-4" />
      </button>
      {on && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-1.5 -right-1.5 grid min-w-[18px] place-items-center rounded-full bg-primary px-1 text-2xs leading-[18px] font-bold text-primary-foreground tabular-nums"
        >
          {count}
        </span>
      )}
    </div>
  );
}

/**
 * The most rows one request may ask for, when a reader coming back from an
 * entry needs every row above their old place back at once. Capped again on
 * the server, which is where the real limit belongs.
 */
const CATCH_UP_PAGE_SIZE = 500;

/** A list's cursor before its first page has been asked for: from the top. */
const FROM_TOP = "";

interface PageResponse {
  readonly rows: readonly RowView[];
  readonly cursor: string | null;
}

/** One list being read a page at a time. */
interface List {
  /** The filter it was read under, as the endpoint's query string; "" for none. */
  readonly query: string;
  readonly rows: readonly RowView[];
  /** Where the next page starts; `FROM_TOP` before the first; null at the end. */
  readonly cursor: string | null;
}

interface PagingState {
  /** The server's first page, which the unfiltered list starts from. */
  readonly first: readonly RowView[];
  /** Everything, newest first, as far as the reader has scrolled it. */
  readonly base: List;
  /** The last filtered list read from the server, kept until another replaces it. */
  readonly narrow: List | null;
  /** The query of whichever of the two is on screen. */
  readonly active: string;
}

interface Paging {
  /** The rows of the list being read. */
  readonly rows: readonly RowView[];
  /** Null once that list has been read to the end. */
  readonly cursor: string | null;
  /** Everything, unfiltered, as far as it has been read. */
  readonly base: readonly RowView[];
  /** Whether `base` is the group's whole history, so a filter can run here. */
  readonly complete: boolean;
  /**
   * The server's filtered list, when the filter is one this browser cannot
   * answer from the rows it holds; null when it can.
   */
  readonly narrowed: {
    readonly rows: readonly RowView[];
    /** Whether its first page has landed. */
    readonly started: boolean;
  } | null;
  /** A page is on its way, or is about to be. */
  readonly busy: boolean;
  readonly failed: boolean;
  readonly retry: () => void;
  readonly sentinelRef: RefObject<HTMLDivElement | null>;
}

/**
 * The rest of the list, fetched as the reader needs it.
 *
 * Two lists, in fact, and one on screen at a time. The unfiltered one starts
 * from the page the server rendered and grows as the reader scrolls. A filter
 * gets a list of its own, read from the top by the endpoint with the filter
 * attached, so each page of it is a page of matches — unless the unfiltered
 * list has already been read to the end, in which case the rows are all here
 * and the filter runs over them without asking anyone (`complete`).
 *
 * Three things ask for a page: the sentinel below the list coming into view, a
 * filtered list that has not read its first page yet, and a reader returning
 * to a place further down than the first page reaches. The first two take a
 * screenful at a time; the last asks for what it needs in one request and
 * stops. Within a list, pages go one request at a time, because the cursor
 * for the next page is only known once the current one has landed. Across
 * lists they do not wait: a request for a filter the reader has typed past is
 * cancelled, not waited out, so the search follows the keyboard.
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
  /** The filter as the endpoint's query string; "" when nothing is filtered. */
  query: string,
  /**
   * Rows to read in without being asked twice, for a reader coming back to a
   * position the first page does not reach. Zero on an ordinary arrival.
   */
  atLeast: number,
): Paging {
  const [state, setState] = useState<PagingState>(() => ({
    first,
    base: { query: "", rows: first, cursor: firstCursor },
    narrow: null,
    active: "",
  }));
  const [failed, setFailed] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const request = useRef<{
    readonly key: string;
    readonly controller: AbortController;
  } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /*
   * Adjusted during render rather than in an effect: React re-runs the
   * component immediately with the new state and before anything paints, so
   * the stale rows never reach the screen.
   *
   * The server sent a different first page — something was added, edited or
   * deleted and the route revalidated — so every page read after it, filtered
   * or not, describes a list that no longer exists. Start again from what it
   * just sent.
   */
  let current = state;
  if (current.first !== first) {
    current = {
      first,
      base: { query: "", rows: first, cursor: firstCursor },
      narrow: null,
      active: "",
    };
  }
  // A filter the rows in hand can answer is answered from them; one they
  // cannot gets its own list, read from the top.
  const active = query !== "" && current.base.cursor !== null ? query : "";
  if (current.active !== active) {
    current = {
      ...current,
      active,
      narrow:
        active === "" || current.narrow?.query === active
          ? current.narrow
          : { query: active, rows: [], cursor: FROM_TOP },
    };
  }
  if (current !== state) {
    setState(current);
    setFailed(false);
  }

  const list = active === "" ? current.base : current.narrow!;
  const { cursor } = list;
  const shortfall = Math.max(0, atLeast - list.rows.length);
  const busy =
    cursor !== null &&
    !failed &&
    (cursor === FROM_TOP || shortfall > 0 || atEnd);

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
    if (!busy || cursor === null) return;
    // This very page is already on its way.
    const key = `${active}\n${cursor}`;
    if (request.current?.key === key) return;
    // A page of a list nobody is looking at any more.
    request.current?.controller.abort();
    const controller = new AbortController();
    request.current = { key, controller };
    const from = cursor;

    void (async () => {
      try {
        const params = new URLSearchParams(active);
        if (from !== FROM_TOP) params.set("cursor", from);
        // Catching up to a remembered position knows exactly how far it has
        // to go, so it asks for that and no more. Everything else takes the
        // server's own page.
        if (shortfall > 0) {
          params.set("limit", String(Math.min(shortfall, CATCH_UP_PAGE_SIZE)));
        }
        const response = await fetch(
          `/api/groups/${groupId}/transactions?${params}`,
          {
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error(`Transactions: ${response.status}`);
        const page = (await response.json()) as PageResponse;
        setState((prev) => withPage(prev, active, from, page));
      } catch {
        // Cancelled on purpose is not a failure: the reader moved on.
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (request.current?.controller === controller) {
          request.current = null;
        }
      }
    })();
  }, [busy, active, cursor, shortfall, groupId]);

  // Leaving the screen cancels what it was waiting for — and forgets it, so a
  // remount (Strict Mode rehearses one) asks again rather than waiting on a
  // request that will never answer.
  useEffect(
    () => () => {
      request.current?.controller.abort();
      request.current = null;
    },
    [],
  );

  const retry = useCallback(() => setFailed(false), []);

  return {
    rows: list.rows,
    cursor,
    base: current.base.rows,
    complete: current.base.cursor === null,
    narrowed:
      active === ""
        ? null
        : { rows: list.rows, started: list.cursor !== FROM_TOP },
    busy,
    failed,
    retry,
    sentinelRef,
  };
}

/**
 * `page`, added to the list it was asked for — if that list is still the one
 * it was asked for, and still waiting at the same place. Otherwise the list
 * was reset or replaced while the request was in the air, and these rows
 * belong to a list that no longer exists.
 */
function withPage(
  state: PagingState,
  query: string,
  from: string,
  page: PageResponse,
): PagingState {
  const list = query === "" ? state.base : state.narrow;
  if (list === null || list.query !== query || list.cursor !== from) {
    return state;
  }
  const next: List = {
    query,
    rows: [...list.rows, ...page.rows],
    cursor: page.cursor,
  };
  return query === "" ? { ...state, base: next } : { ...state, narrow: next };
}

/**
 * How many transactions a filter would leave, asked of the server.
 *
 * Only asked while `enabled` — the sheet is open and the rows in hand are not
 * the whole group — but the last answer is kept, so the sheet does not lose
 * its number while it slides away. Null until there is an answer for exactly
 * this filter: a count for the previous draft is not a count for this one.
 */
function useCount(
  groupId: string,
  query: string,
  enabled: boolean,
): number | null {
  const [answer, setAnswer] = useState<{
    readonly query: string;
    readonly count: number;
  } | null>(null);
  const known = answer !== null && answer.query === query;

  useEffect(() => {
    if (!enabled || known) return;
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    params.set("count", "1");
    void (async () => {
      try {
        const response = await fetch(
          `/api/groups/${groupId}/transactions?${params}`,
          {
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { count: number };
        setAnswer({ query, count: body.count });
      } catch {
        // Offline, or cancelled by the next tap. The button says what it
        // would do without a number, which is still true.
      }
    })();
    return () => controller.abort();
  }, [enabled, known, query, groupId]);

  return known ? answer.count : null;
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
  query,
  onOpen,
}: {
  row: RowView;
  groupId: string;
  rail: string;
  name: string | null;
  /** The list's filters, so the screen this opens can hand them back. */
  query: string;
  onOpen: () => void;
}) {
  const dates = useDateFormatter();
  const Glyph = hasGlyph(row.category)
    ? CATEGORY_GLYPHS[row.category]
    : FALLBACK_GLYPH;

  const badge = badgeOf(row);

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
        {badge && (
          <span className="mt-[5px] flex">
            <TypeBadge kind={badge} />
          </span>
        )}
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
            kind={kindOf(row)}
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
      href={withQuery(
        row.kind === "settlement"
          ? `/groups/${groupId}/settlements/${row.id}`
          : `/groups/${groupId}/expenses/${row.id}`,
        query,
      )}
      transitionTypes={PUSH}
      // Where the reader is standing, noted on the way out rather than on the
      // way back: by the time the list unmounts the router has already been
      // asked to scroll, and `scrollY` is no longer the answer to anything.
      onClick={onOpen}
      // A finger never hovers, so the row answers the press itself — every
      // other list in the app already does.
      //
      // The negative margins that used to pull this out to the full width of
      // the list now sit on `SwipeToDelete` around it, which clips at its own
      // edge — see the note there. The ring is inset for the same reason: an
      // outset one would be cropped by that clip on both sides.
      className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-[7px] transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset active:bg-muted motion-reduce:transition-none"
    >
      {body}
    </Link>
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
