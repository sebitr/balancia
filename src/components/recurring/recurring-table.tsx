import { useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RecurringRowActions } from "./recurring-row-actions";

/**
 * A recurring expense as both of its renderers draw it: already worded on the
 * server, in the reader's language and on the group's calendar.
 *
 * The Recurring screen reads its rules once and builds one of these per rule;
 * the phone's list and the table below are two ways of laying the same rows
 * out, never two loaders.
 */
export interface RecurringRowView {
  readonly id: string;
  readonly description: string;
  /** Minor units, as a decimal string. */
  readonly amount: string;
  readonly currency: string;
  /** The rule in words, from `scheduleSentence`: "Every month on the 1st". */
  readonly schedule: string;
  /**
   * The next date it adds an entry on, formatted on the group's calendar.
   * Null while paused, and for a series that has no date left.
   */
  readonly next: string | null;
  readonly paused: boolean;
  readonly generatedCount: number;
}

const HEAD =
  "h-9 px-3 text-left align-middle text-xs font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase";

/** Hidden in the folded table; a column of its own from 56rem of table. */
const WIDE = "hidden @min-[56rem]:table-cell";

/**
 * The recurring expenses as a table, from `lg` up: the phone's list, drawn at
 * width.
 *
 * The rows are the ones the list is handed and say what its rows say, in the
 * same words — the rule's sentence, the next date or why there is none, how
 * many it has added, the Paused badge — with the row's menu at the end of it,
 * the same menu, offering what the phone's offers. What the width buys is the
 * schedule and the next date as columns of their own, so a reader can run an
 * eye down "when" without reading every row.
 *
 * ## Which columns, at which width
 *
 * Decided by the table's own box, as the transactions table decides it, since
 * the sidebar beside it can be expanded or folded. Under 56rem — a 1024px
 * window beside the expanded sidebar leaves about 46rem — it is Description ·
 * Amount, with the schedule and the next date folded into the description's
 * second line. From 56rem they stand as columns, and the description keeps
 * about 260px once they have taken theirs. A figure is never truncated; only
 * the words are.
 *
 * ## No row link
 *
 * A rule has no screen of its own to open — it is changed in the entry form,
 * which the menu's Edit opens, and only for whoever may change it. So the row
 * is not a link, as the transactions table's are; the menu is the one control
 * in it, and the row takes the hover wash and, while its menu is open, the
 * accent's tint, as the table recipe in the design system has them.
 *
 * A paused rule is drawn in the muted ink as well as badged, the way the
 * board draws it: it is still listed, and it is not running.
 */
export function RecurringTable({
  rows,
  groupId,
  canEdit,
  className,
}: {
  rows: readonly RecurringRowView[];
  groupId: string;
  /** Whether a row's menu offers Edit; see `RecurringRowActions`. */
  canEdit: boolean;
  className?: string;
}) {
  const t = useTranslations("recurringPage");
  const tt = useTranslations("recurringPage.table");

  const paused = rows.filter((row) => row.paused).length;

  /** What the phone's row says under the schedule, in the same words. */
  const nextOf = (row: RecurringRowView): string =>
    row.paused
      ? t("pausedNote")
      : row.next !== null
        ? t("next", { date: row.next })
        : t("noFurther");

  const generatedOf = (row: RecurringRowView): string | null =>
    row.generatedCount > 0
      ? t("generatedSoFar", { count: row.generatedCount })
      : null;

  return (
    <div
      className={cn(
        // The table's own box is what the columns are measured against. It
        // never scrolls sideways: the folding is what keeps it inside.
        "@container overflow-hidden rounded-2xl bg-card ring-1 ring-border",
        className,
      )}
    >
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{t("title")}</caption>
        <thead className="bg-muted/40">
          <tr className="border-b">
            <th scope="col" className={cn(HEAD, "pl-4")}>
              {tt("description")}
            </th>
            <th scope="col" className={cn(HEAD, WIDE, "w-56")}>
              {tt("repeats")}
            </th>
            <th scope="col" className={cn(HEAD, "w-32 text-right")}>
              {tt("amount")}
            </th>
            <th scope="col" className={cn(HEAD, WIDE, "w-56")}>
              {tt("next")}
            </th>
            <th scope="col" className={cn(HEAD, "w-14 pr-4")}>
              <span className="sr-only">{tt("actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const generated = generatedOf(row);
            return (
              <tr
                key={row.id}
                className="border-b transition-colors last:border-b-0 hover:bg-wash-1 has-[[aria-expanded=true]]:bg-primary/9 motion-reduce:transition-none"
              >
                <td className="h-13 py-2 pr-3 pl-4 align-middle">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "min-w-0 truncate font-medium",
                        row.paused && "text-muted-foreground",
                      )}
                    >
                      {row.description}
                    </span>
                    {row.paused && (
                      <Badge variant="secondary" className="shrink-0">
                        {t("pausedBadge")}
                      </Badge>
                    )}
                  </span>
                  {/* The folded second line: the two columns this table
                      leaves out under 56rem, in the order they stand. */}
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground @min-[56rem]:hidden">
                    {[row.schedule, nextOf(row), generated]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </td>

                <td
                  className={cn(
                    WIDE,
                    "px-3 py-2 align-middle",
                    row.paused && "text-muted-foreground",
                  )}
                >
                  {row.schedule}
                </td>

                <td className="px-3 py-2 text-right align-middle">
                  {/* A cost on a schedule, not anybody's balance: plain ink
                      and no sign, as the phone's list writes it. */}
                  <Amount
                    minorUnits={row.amount}
                    currency={row.currency}
                    className={cn(
                      "font-medium whitespace-nowrap",
                      row.paused && "text-muted-foreground",
                    )}
                  />
                </td>

                <td className={cn(WIDE, "px-3 py-2 align-middle")}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className={cn(
                        "truncate",
                        row.paused && "text-xs text-muted-foreground",
                      )}
                    >
                      {/* The column is headed Next, so a date stands bare
                          in it; the two sentences that are not a date say
                          what they say on the phone. */}
                      {!row.paused && row.next !== null
                        ? row.next
                        : nextOf(row)}
                    </span>
                    {generated && (
                      <span className="truncate text-xs text-muted-foreground">
                        {generated}
                      </span>
                    )}
                  </span>
                </td>

                <td className="py-2 pr-4 pl-1 text-right align-middle">
                  <RecurringRowActions
                    groupId={groupId}
                    templateId={row.id}
                    description={row.description}
                    paused={row.paused}
                    canEdit={canEdit}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <p>{tt("footer", { running: rows.length - paused, paused })}</p>
        <p className="text-pretty">{tt("footerNote")}</p>
      </div>
    </div>
  );
}
