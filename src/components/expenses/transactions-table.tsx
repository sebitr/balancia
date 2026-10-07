"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Paperclip } from "lucide-react";
import { useDateFormatter } from "@/i18n/format-context";
import { Amount } from "@/components/money/amount";
import { MemberAvatar, type EntryMember } from "@/components/entries/pills";
import {
  CATEGORY_GLYPHS,
  FALLBACK_GLYPH,
  hasGlyph,
} from "@/components/expenses/category-icon";
import { PUSH } from "@/components/motion/transitions";
import { findPaymentMethod } from "@/modules/settlements/payment-methods";
import { cn } from "@/lib/utils";
import { withQuery } from "./list-query";
import { kindOf, type RowView, type SortChoice } from "./list-filter";
import { badgeOf, Position, TypeBadge } from "./row-parts";

/**
 * The transactions as a table, from `lg` up: the phone's list, drawn at width.
 *
 * Not a second list. The rows are the ones the phone's renderer is handed —
 * the same page from the same loader, narrowed by the same filter, paged by
 * the same hook — and this only decides how much of each row a wide window
 * can lay out side by side. Everything the phone's row says is here, in the
 * same words: the badge, the reader's line under the total, the repayment
 * named from the reader's side. What the width buys is the columns the phone
 * folds into one line or leaves to the entry's own screen — the category, who
 * paid, how it was split, the receipts.
 *
 * ## Which columns, at which width
 *
 * Decided by the table's own box, not the window. The column it sits in is
 * the window less a sidebar, and that sidebar can be expanded or collapsed —
 * so 1280px of window is anywhere from ~970 to ~1150px of table. A container
 * query answers the question that actually matters, and keeps answering it
 * when the frame around the table changes.
 *
 * - Under 60rem (a 1024px window beside an expanded sidebar has ~740px):
 *   Date · Description · Amount. Category, who paid and the split fold into
 *   the description's second line, and the reader's line sits under the
 *   amount.
 * - From 60rem: Category, Paid by and Split stand as columns of their own.
 * - From 68rem: the reader's line gets its own column, For you.
 *
 * The two steps are where the description keeps about 290px once the columns
 * beside it have taken theirs — 672px of fixed columns at the first, 784px at
 * the second. Any earlier and the one column a reader scans a table by would
 * be the one cut short on every row.
 *
 * A figure is never truncated; a column that cannot fit one moves it to a
 * second line instead, which is what the folding is. Only the description
 * truncates, and it truncates before its badges do.
 *
 * ## The row is the link
 *
 * One `<a>` per row, on the description — so the table is still a table to a
 * screen reader, cell by cell, and a keyboard reaches each row with one Tab.
 * Its `::after` is stretched over the whole row (`relative` on the `<tr>`),
 * so a click anywhere on the row opens it, the hover tints the row, and the
 * focus ring is drawn inset around the row rather than around the words.
 */

export interface TransactionsTableProps {
  /** The rows to draw, already filtered and ordered. */
  rows: readonly RowView[];
  groupId: string;
  /** The list's filters, so the screen a row opens can hand them back. */
  query: string;
  /** Called on the way into an entry, to remember the place in the list. */
  onOpen: () => void;
  /** The reader's participant id; null for somebody with no seat in the group. */
  self: string | null;
  /** Everyone in the group now, for "4 of 6". */
  members: readonly EntryMember[];
  /** Today in the group's timezone; a row from another year shows its year. */
  today: string;
  sort: SortChoice;
  /** Whether amounts can be ranked at all — one currency over the group. */
  byAmount: boolean;
  onSort: (sort: SortChoice) => void;
  /** How many rows the list holds read to the end; null while unknown. */
  total: number | null;
  /** More pages wait behind the ones read. */
  more: boolean;
  /** A category's name, as the phone's row names it. */
  nameOf: (category: string) => string;
  className?: string;
}

const HEAD =
  "h-9 px-3 text-left align-middle text-xs font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase";

/** Hidden in the folded table; a column of its own from 60rem of table. */
const WIDE = "hidden @min-[60rem]:table-cell";

export function TransactionsTable({
  rows,
  groupId,
  query,
  onOpen,
  self,
  members,
  today,
  sort,
  byAmount,
  onSort,
  total,
  more,
  nameOf,
  className,
}: TransactionsTableProps) {
  const t = useTranslations("expensesList");
  const tt = useTranslations("expensesList.table");
  const locale = useLocale();
  // One formatter for every row's payers rather than one per row.
  const list = useMemo(
    () => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }),
    [locale],
  );

  // Nothing matches only once there is nothing left to read — the same rule
  // the phone's list keeps, for the same reason.
  if (rows.length === 0 && !more) {
    return (
      <div
        className={cn(
          "mt-4 flex flex-col items-center gap-2 rounded-2xl bg-card px-4 py-9 text-center ring-1 ring-border",
          className,
        )}
      >
        <p className="text-sm font-medium">{t("noMatchTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("noMatchHint")}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        // The table's own box is what the columns are measured against. It
        // never scrolls sideways: the folding is what keeps it inside.
        "@container mt-4 overflow-hidden rounded-2xl bg-card ring-1 ring-border",
        className,
      )}
    >
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{t("eyebrow")}</caption>
        <thead className="bg-muted/40">
          <tr className="border-b">
            <th
              scope="col"
              aria-sort={
                sort === "newest"
                  ? "descending"
                  : sort === "oldest"
                    ? "ascending"
                    : undefined
              }
              className={cn(HEAD, "w-24 pl-4")}
            >
              <SortButton
                label={tt("date")}
                direction={
                  sort === "newest" ? "down" : sort === "oldest" ? "up" : null
                }
                // Newest and oldest are the two ways round one column; from
                // the amount order, the date column starts where the list does.
                onClick={() => onSort(sort === "newest" ? "oldest" : "newest")}
              />
            </th>
            <th scope="col" className={HEAD}>
              {tt("description")}
            </th>
            <th scope="col" className={cn(HEAD, WIDE, "w-32")}>
              {tt("category")}
            </th>
            <th scope="col" className={cn(HEAD, WIDE, "w-40")}>
              {tt("paidBy")}
            </th>
            <th scope="col" className={cn(HEAD, WIDE, "w-28")}>
              {tt("split")}
            </th>
            <th
              scope="col"
              aria-sort={sort === "largest" ? "descending" : undefined}
              className={cn(
                HEAD,
                "w-44 pr-4 text-right @min-[68rem]:w-28 @min-[68rem]:pr-3",
              )}
            >
              {/* Only where the amounts are in one currency: across two,
                  "largest" is a coincidence of denominations, and the sheet
                  withholds the same order for the same reason. */}
              {byAmount ? (
                <SortButton
                  label={tt("amount")}
                  direction={sort === "largest" ? "down" : null}
                  onClick={() =>
                    onSort(sort === "largest" ? "newest" : "largest")
                  }
                />
              ) : (
                tt("amount")
              )}
            </th>
            <th
              scope="col"
              className={cn(
                HEAD,
                "hidden w-44 pr-4 text-right @min-[68rem]:table-cell",
              )}
            >
              {tt("forYou")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TableRow
              key={`${row.kind}-${row.id}`}
              row={row}
              groupId={groupId}
              query={query}
              onOpen={onOpen}
              self={self}
              members={members}
              today={today}
              nameOf={nameOf}
              list={list}
            />
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <p>
          {total === null
            ? tt("footerUncounted", { shown: rows.length, sort })
            : tt("footer", { shown: rows.length, total, sort })}
        </p>
        {more && <p className="text-right">{tt("footerMore")}</p>}
      </div>
    </div>
  );
}

/**
 * A column header that orders the list.
 *
 * The button only says which column it is; the order is the `<th>`'s
 * `aria-sort`, which is what a screen reader announces about a column, and
 * the arrow is that same fact drawn.
 */
function SortButton({
  label,
  direction,
  onClick,
}: {
  label: string;
  direction: "down" | "up" | null;
  onClick: () => void;
}) {
  const Arrow = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap-target -mx-1 inline-flex items-center gap-1 rounded-md px-1 tracking-[0.04em] uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
        direction && "text-foreground",
      )}
    >
      {label}
      {direction && <Arrow aria-hidden="true" className="size-3.5" />}
    </button>
  );
}

function TableRow({
  row,
  groupId,
  query,
  onOpen,
  self,
  members,
  today,
  nameOf,
  list,
}: {
  row: RowView;
  groupId: string;
  query: string;
  onOpen: () => void;
  self: string | null;
  members: readonly EntryMember[];
  today: string;
  nameOf: (category: string) => string;
  list: Intl.ListFormat;
}) {
  const t = useTranslations("expensesList.table");
  const tMethods = useTranslations("paymentMethods");
  const dates = useDateFormatter();
  const badge = badgeOf(row);
  const repayment = row.kind === "settlement";

  // The year only when it is not this one: a column of "12 Aug" reads at a
  // glance, and a row from last August must not pass for this one.
  const date =
    row.date.slice(0, 4) === today.slice(0, 4)
      ? dates.plain(row.date, "dayMonth")
      : dates.plain(row.date);

  // "You" in the reader's place, and the names joined the way the language
  // joins them: "Jonas and Ravi", "Jonas et Ravi".
  const names = list.format(
    row.payers.map((payer, index) =>
      payer === self ? t("you") : (row.payerNames[index] ?? ""),
    ),
  );

  const category = repayment ? null : nameOf(row.category ?? "");
  const Glyph =
    row.category !== null && hasGlyph(row.category)
      ? CATEGORY_GLYPHS[row.category]
      : FALLBACK_GLYPH;

  /*
   * A repayment is not shared out, so its Split says how it was paid — "Cash",
   * "TWINT" — when whoever recorded it said. An unrecognised method came in
   * through the API or an import and is shown exactly as it was recorded, as
   * the repayment's own screen shows it.
   */
  const method =
    row.method === null
      ? null
      : (() => {
          const known = findPaymentMethod(row.method);
          return known ? tMethods(known.id) : row.method;
        })();

  const split = row.split
    ? t("split_ways", splitWays(row.split, members))
    : method;

  /*
   * The folded second line: what the wide table spreads across three columns,
   * in the order the columns stand — category, who paid, the split — and the
   * receipts last, as the design system's row grammar has them. A repayment's
   * is how it was paid and what it was for.
   */
  const folded = repayment
    ? [method, row.note]
    : [
        category,
        row.payers.length === 0
          ? null
          : t("paidByLine", {
              who:
                self !== null &&
                row.payers.length === 1 &&
                row.payers[0] === self
                  ? "you"
                  : self !== null && row.payers.includes(self)
                    ? "withYou"
                    : "other",
              names,
              count: row.payers.length,
            }),
        split,
        row.receipts > 0 ? t("receipts", { count: row.receipts }) : null,
      ];

  return (
    <tr className="relative border-b transition-colors last:border-b-0 hover:bg-wash-1 has-[a:focus-visible]:bg-wash-1 motion-reduce:transition-none">
      <td className="h-13 py-2 pr-3 pl-4 align-middle whitespace-nowrap text-muted-foreground tabular-nums">
        {date}
      </td>

      <td className="px-3 py-2 align-middle">
        <span className="flex min-w-0 items-center gap-1.5">
          <Link
            href={withQuery(
              repayment
                ? `/groups/${groupId}/settlements/${row.id}`
                : `/groups/${groupId}/expenses/${row.id}`,
              query,
            )}
            transitionTypes={PUSH}
            onClick={onOpen}
            className="min-w-0 truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            {row.title}
          </Link>
          {badge && <TypeBadge kind={badge} />}
          {row.receipts > 0 && (
            <span className="hidden shrink-0 items-center gap-0.5 text-xs text-muted-foreground tabular-nums @min-[60rem]:inline-flex">
              <Paperclip aria-hidden="true" className="size-3.5" />
              <span aria-hidden="true">{row.receipts}</span>
              <span className="sr-only">
                {t("receipts", { count: row.receipts })}
              </span>
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground @min-[60rem]:hidden">
          {folded.filter(Boolean).join(" · ")}
        </span>
        {/* At width a repayment's own words still need a line: they are not
            a column, and the phone's row keeps them under the names too. */}
        {repayment && row.note && (
          <span className="mt-0.5 hidden truncate text-xs text-muted-foreground @min-[60rem]:block">
            {row.note}
          </span>
        )}
      </td>

      <td className={cn(WIDE, "px-3 py-2 align-middle")}>
        {category !== null && (
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <Glyph aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{category}</span>
          </span>
        )}
      </td>

      <td className={cn(WIDE, "px-3 py-2 align-middle")}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 -space-x-1.5">
            {row.payers.slice(0, 2).map((payer, index) => (
              <MemberAvatar
                key={payer}
                name={row.payerNames[index] ?? ""}
                // The reader's own face in the accent, as the "you" pill is
                // everywhere else. Who paid is not money; the amount is.
                selected={payer === self}
                className="size-6 ring-2 ring-card"
              />
            ))}
          </span>
          <span className="truncate">{names}</span>
        </span>
      </td>

      <td className={cn(WIDE, "px-3 py-2 align-middle")}>
        {split !== null && (
          <span className="block truncate text-muted-foreground">{split}</span>
        )}
      </td>

      <td className="py-2 pr-4 pl-3 text-right align-middle @min-[68rem]:pr-3">
        <span className="flex flex-col items-end gap-0.5">
          {/* A cost has no direction, so the total takes no tone — the
              reader's line under it is what does. A repayment's total is
              muted as on the phone: it moves money, it is not spending. */}
          <Amount
            minorUnits={row.amount}
            currency={row.currency}
            signDisplay={row.revenue ? "always" : undefined}
            className={cn(
              "font-medium whitespace-nowrap",
              repayment && "text-muted-foreground",
            )}
          />
          {row.position !== null && (
            <Position
              minorUnits={row.position}
              currency={row.currency}
              kind={kindOf(row)}
              className="@min-[68rem]:hidden"
            />
          )}
        </span>
      </td>

      <td className="hidden py-2 pr-4 pl-3 text-right align-middle @min-[68rem]:table-cell">
        {row.position !== null && (
          <Position
            minorUnits={row.position}
            currency={row.currency}
            kind={kindOf(row)}
          />
        )}
      </td>
    </tr>
  );
}

/**
 * How an expense was shared, in the fewest words: "6 equally" when everyone
 * carries a share, "4 of 6" when some do, and the method beside it when it was
 * not an even split.
 *
 * "Everyone" is the group now plus anybody on the split who has since left,
 * so a split made before somebody was removed still reads as everyone rather
 * than as "6 of 5".
 */
function splitWays(
  split: NonNullable<RowView["split"]>,
  members: readonly EntryMember[],
): { scope: "all" | "some"; method: string; count: number; total: number } {
  const everyone = new Set(members.map((member) => member.id));
  for (const sharer of split.sharers) everyone.add(sharer);
  const count = split.sharers.length;
  return {
    scope: count === everyone.size ? "all" : "some",
    method: split.method,
    count,
    total: everyone.size,
  };
}

/*
 * Which of the two renderers is mounted.
 *
 * `lg` is 64rem, and from there the table is drawn instead of the list. Both
 * are in the server's HTML and the first client render — the server cannot
 * know the width, and hydration has to match what it sent — with CSS showing
 * exactly one; `display: none` keeps the other out of the accessibility tree
 * as well as off the screen. From the next render on, only the one the window
 * can see is mounted, so a phone does not carry a hidden table of every row it
 * holds, nor a desk a hidden list of them.
 *
 * The hook itself is shared with the entry dialog, which lays its split out in
 * place from the same width.
 */
export { useDeskWidth } from "@/components/ui/use-desk-width";
