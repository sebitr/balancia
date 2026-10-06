"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Bell,
  ChevronDown,
  Download,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TONE } from "@/components/money/balance-tone";
import { useDateFormatter } from "@/i18n/format-context";
import type { NotificationType } from "@/modules/notifications/types";
import { cn } from "@/lib/utils";
import { initialOf } from "@/components/entries/initials";
import { useSwipeAway } from "@/components/ui/use-swipe-away";
import { isPlainCreation, type InboxRow } from "./grouping";

/**
 * The shapes a notification takes in the inbox.
 *
 * Four of them, and the difference between them is what the reader is expected
 * to *do*. An activity row is news and opens the thing it is about. A burst is
 * news that repeated itself and folds. An import is a receipt for something the
 * reader started and sits at the foot of the day. A reminder is somebody asking
 * for money, so it is the only one drawn as a card with buttons on it.
 *
 * Everything here is presentation: the wording arrived rendered from the
 * server, the grouping arrived decided by `grouping.ts`, and the state lives in
 * `notification-list.tsx`.
 *
 * ## From `lg` up
 *
 * The same rows, drawn for a desk: a 36px face rather than 30, a 60px row, the
 * figure at a reading size, and each day's run of rows set in a card — which is
 * why a row's swipe layer is painted the card's colour there rather than the
 * page's. The reminder becomes the card the desktop board draws: who sent it,
 * their words, the group, what they ask for at the right in the debt's own
 * tone, and its buttons in a footer. Every class that does this is `lg:`, so a
 * phone renders exactly what it did.
 */

/**
 * The badge over an avatar, per event.
 *
 * Adding an expense is the ordinary case and wears no badge — sixteen rows each
 * with a plus over the face is a pattern rather than a signal. Everything else
 * is a departure from it and says which.
 */
const EVENT_ICONS: Record<NotificationType, LucideIcon> = {
  "expense.created": Plus,
  "expense.updated": Pencil,
  "expense.deleted": Trash2,
  "settlement.created": ArrowRight,
  "settlement.updated": Pencil,
  "settlement.deleted": Trash2,
  "recurring.generated": Repeat,
  "import.completed": Download,
  "reminder.received": Bell,
};

/**
 * The dot beside a group's name.
 *
 * Three hues off the chart palette, picked from the group's id so the same
 * group keeps the same colour between visits without anything being stored.
 * The colour is never the only thing saying which group a row belongs to — the
 * name is right beside it.
 */
const GROUP_DOTS = ["bg-chart-4", "bg-chart-3", "bg-chart-5"] as const;

export function groupDot(groupId: string): string {
  let hash = 0;
  for (const character of groupId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 9973;
  }
  return GROUP_DOTS[hash % GROUP_DOTS.length]!;
}

/**
 * How long ago, in the width of a thumbnail.
 *
 * "10h" rather than "10 hours ago": the column is one line wide beside an
 * amount, and the reader is scanning for order, not reading a sentence. The
 * full date stays in `title` and `dateTime`, so nothing is lost to the
 * shortening.
 *
 * `now` is pinned by the server render and passed down — computed here it
 * would be read off two different clocks and hydration would disagree with
 * itself.
 */
function useAge(value: string, now: string) {
  const t = useTranslations("notificationsPage");
  const dates = useDateFormatter();
  const date = new Date(value);
  const minutes = Math.max(
    0,
    Math.round((Date.parse(now) - date.getTime()) / 60_000),
  );

  const short =
    minutes < 1
      ? t("ageNow")
      : minutes < 60
        ? t("ageMinutes", { count: minutes })
        : minutes < 60 * 24
          ? t("ageHours", { count: Math.floor(minutes / 60) })
          : t("ageDays", { count: Math.floor(minutes / (60 * 24)) });

  return { short, long: dates.at(date, { style: "long" }) };
}

function Age({
  value,
  now,
  className,
}: {
  value: string;
  now: string;
  className?: string;
}) {
  const { short, long } = useAge(value, now);
  return (
    <time
      dateTime={value}
      title={long}
      className={cn("text-2xs text-muted-foreground", className)}
    >
      {short}
    </time>
  );
}

/** The sentence, the amount, and how long ago — for a screen reader, in order. */
function spoken(parts: (string | null | false)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(", ");
}

type PageTranslate = ReturnType<typeof useTranslations<"notificationsPage">>;

/**
 * What a folded run says: "Hervé made 3 changes to jardinier".
 *
 * Shared with the list, which names the run's Dismiss button with it — the
 * button and the row it takes away must not be worded two ways.
 */
export function burstSentence(
  t: PageTranslate,
  rows: readonly InboxRow[],
): string {
  const first = rows[0]!;
  return t("burst", {
    actor: first.actor ?? "",
    count: rows.length,
    description: first.subject ?? first.groupName,
  });
}

/** What a day's finished imports say: the one, or how many. As above. */
export function digestSentence(
  t: PageTranslate,
  rows: readonly InboxRow[],
): string {
  return rows.length > 1
    ? t("importsFinished", { count: rows.length })
    : rows[0]!.sentence;
}

function Avatar({ row }: { row: InboxRow }) {
  const Icon = EVENT_ICONS[row.type];
  const badged = !isPlainCreation(row.type);
  const deleted = row.type.endsWith(".deleted");

  return (
    <span className="relative">
      <span className="flex size-[30px] items-center justify-center rounded-full bg-accent text-2xs font-semibold text-accent-foreground lg:size-9 lg:text-xs">
        {/* Nothing was done by anybody: an automatic entry gets a blank disc. */}
        {row.actor ? initialOf(row.actor) : null}
      </span>
      {badged && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -right-[3px] -bottom-[3px] flex size-[15px] items-center justify-center rounded-full ring-2 ring-background lg:size-4 lg:ring-card",
            deleted
              ? "bg-destructive/90 text-foreground"
              : "bg-[color-mix(in_oklch,var(--accent),var(--foreground)_12%)] text-foreground",
          )}
        >
          <Icon className="size-2.5" />
        </span>
      )}
    </span>
  );
}

/** The unread marker. Colour alone never carries it — see `spoken` above. */
function UnreadDot({
  unread,
  className,
}: {
  unread: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-[7px] justify-self-center rounded-full lg:size-2",
        unread ? "bg-primary" : "bg-transparent",
        className,
      )}
    />
  );
}

/** The right-hand column: what it cost, and how long ago. */
function Trailing({
  amount,
  createdAt,
  now,
  children,
}: {
  amount: string | null;
  createdAt: string;
  now: string;
  children?: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 justify-self-end">
      <span className="flex flex-col items-end">
        {amount && (
          <span className="text-xs font-semibold tabular-nums lg:text-sm lg:font-medium">
            {amount}
          </span>
        )}
        <Age value={createdAt} now={now} />
      </span>
      {children}
    </span>
  );
}

const ROW_GRID =
  "grid w-full grid-cols-[10px_30px_1fr_auto] items-center gap-2.5 px-0.5 pt-[9px] pb-2.5 text-left lg:min-h-15 lg:grid-cols-[10px_36px_minmax(0,1fr)_auto] lg:gap-3 lg:px-4 lg:py-2.5 lg:transition-colors lg:hover:bg-wash-1 lg:motion-reduce:transition-none";

/**
 * Inset from `lg`, where the row runs to the edges of its card and a ring
 * drawn outside it would be cut off by the card's rounded corners.
 */
const ROW_FOCUS =
  "rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:rounded-none lg:focus-visible:ring-inset";

/**
 * The hairline under a row, starting where the sentence does.
 *
 * From `lg` it runs the card's full width, as a table's rule does, and the
 * last row of a card leaves it out — the card's own edge is the line there.
 */
export function RowDivider({ last = false }: { last?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ml-[52px] block h-px bg-wash-3 lg:ml-0 lg:bg-border",
        last && "lg:hidden",
      )}
    />
  );
}

export function GroupChip({
  row,
  onOpen,
}: {
  row: InboxRow;
  onOpen: () => void;
}) {
  const t = useTranslations("notificationsPage");
  return (
    <button
      type="button"
      // The chip sits inside a row that opens something else; a tap on it must
      // be about the group and nothing more.
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      aria-label={t("groupOptions", { group: row.groupName })}
      className={cn(
        "mt-2.5 mb-0.5 flex items-center gap-1.5 pl-[22px] text-2xs font-semibold text-foreground/75",
        // From `lg`, inside the card: level with the faces below it.
        "lg:mt-3 lg:mb-0 lg:pl-[38px] lg:text-xs",
        ROW_FOCUS,
        "lg:rounded-md",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", groupDot(row.groupId))}
      />
      {row.groupName}
    </button>
  );
}

export function ActivityRow({
  row,
  now,
  onOpen,
}: {
  row: InboxRow;
  now: string;
  onOpen: () => void;
}) {
  const t = useTranslations("notificationsPage");
  const { short } = useAge(row.createdAt, now);

  return (
    <button
      type="button"
      onClick={onOpen}
      // jsdom aside, a screen reader would otherwise run the sentence, the
      // amount and the timestamp together into one unpunctuated string.
      aria-label={spoken([
        row.sentence,
        row.amount,
        short,
        !row.read && t("unread"),
      ])}
      className={cn(ROW_GRID, ROW_FOCUS)}
    >
      <UnreadDot unread={!row.read} />
      <Avatar row={row} />
      <span className="text-sm/[1.35] text-pretty">{row.sentence}</span>
      <Trailing amount={row.amount} createdAt={row.createdAt} now={now} />
    </button>
  );
}

/**
 * Several changes to one thing, folded into a line that can be opened.
 *
 * The children are the individual events, newest first, each with the glyph of
 * what it was — which is the part a reader actually wants out of a burst:
 * whether the run ends in an edit or in a deletion.
 */
export function BurstRow({
  rows,
  now,
  open,
  onToggle,
}: {
  rows: readonly InboxRow[];
  now: string;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("notificationsPage");
  const first = rows[0]!;
  const unread = rows.some((row) => !row.read);
  const sentence = burstSentence(t, rows);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={spoken([sentence, unread && t("unread")])}
        className={cn(ROW_GRID, ROW_FOCUS)}
      >
        <UnreadDot unread={unread} />
        <Avatar row={first} />
        <span className="text-sm/[1.35] text-pretty">{sentence}</span>
        <Trailing amount={null} createdAt={first.createdAt} now={now}>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-3 text-muted-foreground transition-transform duration-[160ms] motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </Trailing>
      </button>

      {open && (
        <ul>
          {rows.map((row) => {
            const Icon = EVENT_ICONS[row.type];
            return (
              <li
                key={row.id}
                className="grid grid-cols-[16px_1fr_auto] items-center gap-2.5 py-[7px] pr-0.5 pl-[52px] lg:pr-4 lg:pl-[74px]"
              >
                <Icon
                  aria-hidden="true"
                  className="size-3 text-muted-foreground"
                />
                <span className="text-xs text-foreground/85">
                  {row.sentence}
                </span>
                {row.amount && (
                  <span className="text-xs font-semibold tabular-nums">
                    {row.amount}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * Finished imports, at the foot of their day.
 *
 * One is a plain row that opens the group's expenses — there is nothing to
 * expand, so it is given no chevron to suggest there is. Two or more become a
 * count that opens.
 */
export function ImportDigest({
  rows,
  now,
  open,
  onToggle,
  onOpen,
}: {
  rows: readonly InboxRow[];
  now: string;
  open: boolean;
  onToggle: () => void;
  onOpen: (row: InboxRow) => void;
}) {
  const t = useTranslations("notificationsPage");
  const first = rows[0]!;
  const many = rows.length > 1;
  const sentence = digestSentence(t, rows);
  const { short } = useAge(first.createdAt, now);

  return (
    <>
      <button
        type="button"
        onClick={many ? onToggle : () => onOpen(first)}
        aria-expanded={many ? open : undefined}
        aria-label={spoken([sentence, short])}
        className={cn(ROW_GRID, ROW_FOCUS)}
      >
        <span aria-hidden="true" />
        <span className="flex size-[30px] items-center justify-center rounded-full bg-wash-2 lg:size-9">
          <Download
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
          />
        </span>
        <span className="text-xs text-pretty text-muted-foreground">
          {sentence}
        </span>
        <Trailing amount={null} createdAt={first.createdAt} now={now}>
          {many && (
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-3 text-muted-foreground transition-transform duration-[160ms] motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          )}
        </Trailing>
      </button>

      {many && open && (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpen(row)}
                aria-label={row.sentence}
                className={cn(
                  "grid w-full grid-cols-[1fr_auto] items-center gap-2.5 py-[7px] pr-0.5 pl-[52px] text-left lg:pr-4 lg:pl-[74px]",
                  ROW_FOCUS,
                )}
              >
                <span className="text-xs text-muted-foreground">
                  {row.sentence}
                </span>
                <Age value={row.createdAt} now={now} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Somebody asking for money.
 *
 * A card rather than a row, because it is the one kind with something to
 * decide. The message is the sender's own words, reproduced as written and
 * never translated; the two actions are the two things the reader can do about
 * it without leaving the sentence they just read.
 *
 * From `lg` the card has the room the desktop board gives it, and says the
 * same things in a different order: who sent it ("Ravi sent you a reminder"),
 * their words in quotes, the group, and at the right what they ask for — the
 * figure and "you owe" in the debt's own tone, never the accent. A reminder is
 * only ever sent by somebody the reader owes, so the tone is fixed; the figure
 * is the one the reminder was sent about, every currency named. The phone's
 * headline, which carries the same figure and group in one line, stands in
 * when the sender has no name. Its buttons move to a footer and gain "Open
 * group", which a phone reaches by tapping the group's chip instead.
 */
export function ReminderCard({
  row,
  now,
  onSettle,
  onCopy,
  onOpen,
}: {
  row: InboxRow;
  now: string;
  onSettle: () => void;
  onCopy: () => void;
  /** The group the reminder is about. Offered from `lg`. */
  onOpen: () => void;
}) {
  const t = useTranslations("notificationsPage");
  const tDashboard = useTranslations("dashboard");
  const owes = TONE.negative.ink;
  // Sized up to the desk's button from `lg`, where the footer has the room.
  const action = "lg:h-9 lg:px-3.5 lg:text-sm";

  return (
    <div className="my-2 rounded-xl border border-primary/30 bg-card p-3.5 lg:my-0 lg:overflow-hidden lg:rounded-2xl lg:border-negative/35 lg:p-0">
      <div className="lg:grid lg:grid-cols-[10px_44px_minmax(0,1fr)_auto] lg:items-center lg:gap-3.5 lg:py-4 lg:pr-5 lg:pl-2.5">
        <UnreadDot unread={!row.read} className="hidden lg:block" />
        <span
          aria-hidden="true"
          className="hidden size-11 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground lg:flex"
        >
          {row.actor ? initialOf(row.actor) : null}
        </span>

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2 lg:items-baseline lg:justify-start">
            <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums lg:text-base">
              <Bell
                aria-hidden="true"
                className="size-3.5 shrink-0 text-primary-ink lg:hidden"
              />
              <span className={cn(row.actor && "lg:hidden")}>{row.title}</span>
              {row.actor && (
                <span className="hidden lg:inline">
                  {t("reminderFrom", { name: row.actor })}
                </span>
              )}
            </p>
            <Age value={row.createdAt} now={now} className="shrink-0" />
          </div>

          <p className="mt-1.5 text-xs/[1.45] text-pretty text-foreground/85 lg:mt-1 lg:text-sm lg:text-muted-foreground lg:before:content-[open-quote] lg:after:content-[close-quote]">
            {row.sentence}
          </p>

          <p className="hidden text-xs text-muted-foreground lg:mt-1 lg:block">
            {row.groupName}
          </p>
        </div>

        {row.debt && (
          <p className="hidden flex-col items-end gap-0.5 text-right lg:flex">
            <span
              className={cn(
                "text-2xl font-semibold tracking-tight tabular-nums",
                owes,
              )}
            >
              {row.debt}
            </span>
            <span className={cn("text-sm font-medium", owes)}>
              {tDashboard("wordYouOwe")}
            </span>
          </p>
        )}
      </div>

      <div className="mt-2.5 flex gap-2 lg:mt-0 lg:border-t lg:bg-muted/40 lg:px-5 lg:py-2.5">
        <Button size="sm" onClick={onSettle} className={action}>
          {t("settleUp")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onOpen}
          className={cn("hidden lg:inline-flex", action)}
        >
          {t("openGroup")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCopy} className={action}>
          {t("copyLink")}
        </Button>
      </div>
    </div>
  );
}

/**
 * A row that can be pushed off to the left.
 *
 * The reveal sits behind and never moves; the layer above it carries the row
 * and an opaque background, so what shows through is exactly how far the
 * finger has travelled. The button beside it is the same action without the
 * gesture — invisible until it is focused, because a list of sixteen rows does
 * not need sixteen visible Dismiss buttons, and unreachable by pointer, which
 * is what the swipe is for.
 *
 * That opaque layer is a `flow-root` so that it contains the margins of
 * whatever it is given. A child with a vertical margin — the reminder card has
 * one — otherwise collapses its margin straight out through a parent with no
 * padding or border, leaving the layer short at both ends and a strip of the
 * red reveal standing above and below the row as if it were a border.
 *
 * The button says which row it takes away — "Dismiss “Hervé added Raclette”"
 * — because a screen reader's list of buttons, or a voice command, would
 * otherwise offer sixteen identical "Dismiss"es and no way to tell them apart.
 * It still begins with the word it shows when focused.
 *
 * From `lg` a row sits in a card, so the layer takes the card's colour there;
 * the reminder, a card of its own on the page, keeps the page's.
 */
export function Dismissible({
  name,
  onCard = false,
  onDismiss,
  children,
}: {
  /** What the row says, for the button's accessible name. */
  name: string;
  /** The row sits in one of the day's cards from `lg`. */
  onCard?: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  const tPage = useTranslations("notificationsPage");
  const swipe = useSwipeAway(onDismiss);

  return (
    <div className="relative overflow-hidden">
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-end bg-destructive/15 pr-4"
      >
        <span className="text-2xs font-semibold text-destructive-ink">
          {t("dismiss")}
        </span>
      </span>

      <div
        ref={swipe}
        className={cn(
          "relative flow-root touch-pan-y bg-background",
          onCard && "lg:bg-card",
        )}
      >
        {children}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={tPage("dismissNamed", { row: name })}
          className={cn(
            "sr-only focus:not-sr-only focus:absolute focus:top-1 focus:right-0 focus:z-10",
            "focus:rounded-md focus:bg-destructive/15 focus:px-2 focus:py-1",
            "focus:text-2xs focus:font-semibold focus:text-destructive-ink",
            "focus:ring-2 focus:ring-ring focus:outline-none",
          )}
        >
          {t("dismiss")}
        </button>
      </div>
    </div>
  );
}
