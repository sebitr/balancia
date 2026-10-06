import { Download, Minus } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initialOf } from "./initials";
import { cn } from "@/lib/utils";
import {
  TONE,
  toneFor,
  type BalanceTone,
} from "@/components/money/balance-tone";

/**
 * The read-only half of the entry vocabulary.
 *
 * `add-entry-form` and its blocks are how an entry is written; this is how one
 * is read back. The three detail screens — an expense, a revenue, a repayment —
 * are the same skeleton with different words in it: a header card that states
 * what kind of transaction this is and what it came to, one or two party cards
 * that name everybody it touched, the files, and the actions.
 *
 * Everything here is presentational and stays on the server. The only client
 * components in the tree are the leaves that have to be — `Amount`, which reads
 * the reader's number notation from context, and Radix's `Avatar`.
 *
 * Sizes are scale steps. They arrived from the handoff as literals — the
 * screens were drawn at 390pt, so `text-[13px]` was written meaning thirteen
 * pixels on a phone — and a literal does render the size it names. What it
 * cannot do is move: `globals.css` lifts every step by a point below `md`, and
 * a literal sits out that lift. Two of them had drifted under the floor that
 * way (a 10px uppercase label above each field of the meta strip, an 11px
 * chip), and the row titles read a point under the `text-sm` the rest of the
 * app sets the same rows in. The mapping back was 10/11/12 -> `text-2xs`,
 * 13 -> `text-xs`, 14 -> `text-sm`, 17 -> `text-base`.
 *
 * The 40px figure below stays a literal: display numerals on a balance hero
 * are the scale's one documented exception, and this is one of them.
 */

/** Which of the three a screen is. Decides the chip. */
export type EntryTone = "expense" | "revenue" | "settlement";

/**
 * Colour marks the exception. An expense is what an entry is unless it says
 * otherwise, so its chip is plum on plum and carries no tone of its own. It
 * used to wear the accent, which put a coral chip above a coral-red figure
 * and, with a mint accent, a green expense chip beside the green income one.
 */
const CHIP_TONE: Record<EntryTone, string> = {
  expense: "bg-secondary text-secondary-foreground",
  revenue: "bg-positive/15 text-positive-ink",
  settlement: "bg-payer/15 text-payer-ink",
};

const DISC_TONE: Record<EntryTone, string> = {
  expense: "bg-wash-4",
  revenue: "bg-positive/25",
  settlement: "bg-payer/25",
};

/** Every card on these screens: one surface, one hairline, one radius. */
export function DetailCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[17px] bg-card shadow-[0_0_0_1px_var(--border)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A labelled group of rows.
 *
 * The split method rides beside the label rather than up in the header strip,
 * because it describes the rows below it and nothing else on the screen.
 */
export function Section({
  label,
  chip,
  children,
}: {
  label: string;
  chip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {label}
        </h2>
        {chip}
      </div>
      {children}
    </section>
  );
}

/** The chip that names the transaction's kind, tinted and led by a glyph. */
export function TypeChip({
  tone,
  icon: Icon,
  label,
}: {
  tone: EntryTone;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-[5px] text-xs font-semibold",
        CHIP_TONE[tone],
      )}
    >
      <span
        className={cn(
          "grid size-[18px] shrink-0 place-items-center rounded-full",
          DISC_TONE[tone],
        )}
      >
        <Icon aria-hidden={true} className="size-[11px]" />
      </span>
      {label}
    </span>
  );
}

/**
 * A neutral fact about the entry — its category, how it was paid.
 *
 * The `small` form is the one that rides beside a section label rather than in
 * the header strip: it sits on a `text-2xs` line rather than a `text-base` one,
 * so it comes down a step to match.
 */
export function MetaChip({
  icon: Icon,
  small = false,
  children,
}: {
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-secondary font-medium text-secondary-foreground",
        small
          ? "h-[22px] gap-[5px] px-[9px] text-2xs"
          : "h-[26px] gap-1.5 px-2.5 text-xs",
      )}
    >
      {Icon && (
        <Icon
          aria-hidden={true}
          className={cn("shrink-0", small ? "size-[11px]" : "size-3")}
        />
      )}
      {children}
    </span>
  );
}

/** Outlined rather than filled: a count is not a fact about the money. */
export function CountChip({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Read instead of the bare figure, which on its own says nothing. */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full border border-input px-2.5 text-xs font-medium text-muted-foreground">
      <Icon aria-hidden={true} className="size-[11px] shrink-0" />
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Which side of the figure this reader's notation puts the currency on.
 *
 * The handoff draws `− CHF 364.00`, which is where an English reader expects
 * it — and every other figure on the screen goes through `Intl`, which in
 * French puts it after. Left as drawn, one screen said `− CHF 364,00` at the
 * top and `121,33 CHF` in every row underneath.
 */
function currencyLeads(locale: string, currency: string): boolean {
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).formatToParts(1);
  const at = parts.findIndex((part) => part.type === "currency");
  return at !== -1 && at < parts.findIndex((part) => part.type === "integer");
}

/**
 * The figure the whole screen is about, and the line that says what it means
 * to whoever is reading.
 *
 * The total is a fact about the entry, the same for everybody in it, so it
 * carries no sign and no colour. It used to be a red "− 90.00" on every
 * expense — the "you owe" red, in front of the person who had paid for the
 * table and was owed most of it. The direction belongs to each person's part
 * in the money rather than to the total, and the `caption` under it is where
 * the reader's own part is said, in words and in its money tone.
 *
 * The currency sits on the figure's baseline at a third of its size: it
 * qualifies the number rather than competing with it. The row wraps rather
 * than running off the card, so a seven-figure total on a narrow phone puts
 * its currency on a line of its own instead of losing digits under the edge.
 *
 * That makes this one of the two exceptions written out at `formatMoney`; the
 * caption under it, like every other figure on the screen, is in the app's
 * one notation.
 */
export function BigAmount({
  minorUnits,
  currency,
  locale,
  caption,
}: {
  minorUnits: string;
  currency: string;
  /** The reader's number notation, which decides where the currency sits. */
  locale: string;
  /** The reader's own part in it, one line under the figure. */
  caption?: React.ReactNode;
}) {
  const leads = currencyLeads(locale, currency);
  const qualifier = (
    <span className="text-base font-medium text-muted-foreground">
      {currency}
    </span>
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="flex flex-wrap items-baseline gap-x-2 leading-none">
        {leads && qualifier}
        <span className="text-[40px] font-semibold tracking-[-0.03em]">
          <Amount minorUnits={minorUnits} currency={currency} display="none" />
        </span>
        {!leads && qualifier}
      </span>
      {caption}
    </div>
  );
}

/**
 * The reader's part in an entry, as one sentence under its total.
 *
 * The sentence arrives whole from the catalogue; the part of it that carries
 * a direction — "you get back €60.00" — comes wrapped in a `StakeTone`, and
 * only that part is coloured. Colour is the last cue here, never the first:
 * the words already say which way the money goes.
 */
export function StakeLine({
  quiet = false,
  children,
}: {
  /** For a reader with no part in the entry: nothing to stand out. */
  quiet?: boolean;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "text-sm font-medium",
        quiet ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {children}
    </p>
  );
}

/** The directional half of a `StakeLine`, in its money tone. */
export function StakeTone({
  tone,
  children,
}: {
  tone: BalanceTone;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("font-semibold", TONE[tone].ink)}>{children}</span>
  );
}

/** One field of the strip under the amount: its name, then what it says. */
export function MetaField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-[3px]", className)}>
      <span className="text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
        {children}
      </span>
    </div>
  );
}

/** Separated from the amount above it, and the width of the card. */
export function MetaStrip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 border-t border-border pt-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Which of three things a face is: you, whoever put the money in, or anybody
 * else. Coral is already "this is you" everywhere in the app, and amber is
 * already the payer — the one role coral cannot carry, because the payer is
 * usually in the split as well.
 */
export type PersonTone = "other" | "self" | "payer";

const AVATAR_TONE: Record<PersonTone, string> = {
  other: "bg-secondary font-semibold text-secondary-foreground",
  self: "bg-primary/18 font-bold text-primary-ink",
  payer: "bg-payer font-bold text-payer-foreground",
};

export function PersonAvatar({
  name,
  tone = "other",
  small = false,
}: {
  name: string;
  tone?: PersonTone;
  /** The 22px form, for the two faces inside a meta field. */
  small?: boolean;
}) {
  return (
    <Avatar className={cn("shrink-0", small ? "size-[22px]" : "size-[30px]")}>
      <AvatarFallback
        className={cn(small ? "text-2xs" : "text-xs", AVATAR_TONE[tone])}
      >
        {initialOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Every row in these cards is 56px and states its own height.
 *
 * No vertical padding: a row that grew with its contents would leave the two
 * party cards on the same screen at different row heights, and the figures in
 * them would stop lining up across the gap between them.
 */
const ROW = "flex min-h-[56px] items-center gap-2.5 px-3.5";

/** A person and one figure — who paid, who received. */
export function PartyRow({
  name,
  tone,
  minorUnits,
  currency,
}: {
  name: string;
  tone: PersonTone;
  minorUnits: string;
  currency: string;
}) {
  return (
    <div className={ROW}>
      <PersonAvatar name={name} tone={tone} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        {name}
      </span>
      <Amount
        minorUnits={minorUnits}
        currency={currency}
        className="shrink-0 text-sm font-semibold"
      />
    </div>
  );
}

/**
 * Who an entry was split between, one line per person.
 *
 * This was a three-column table — person, share, balance — and on a phone it
 * did not fit: 370px of minimum widths in a 343px card that clips, so the
 * balance column lost its last digits and its heading read "BALANC". Nothing
 * in a table can give way except the names, and they had nothing left to give.
 *
 * So each person is a row of two lines instead. The first is the name and
 * the share, the one figure the list has in common, right-aligned so the
 * shares line up down the card. The second says in words what the entry did
 * to that person — the column of bare "+ €60.00" said it only in a sign and
 * a colour, with the words hidden for screen readers. That line has the full
 * width of the row to itself and wraps rather than clipping.
 *
 * The heading above the shares is drawn for the eye only; each figure carries
 * its own name for a screen reader, which reads the list a row at a time.
 */
export function SplitList({
  figureLabel,
  children,
}: {
  /** What the right-hand figure is: a share, or what was credited. */
  figureLabel: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        className="flex h-8 items-center justify-end border-b border-border bg-wash-1 px-3.5 text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        {figureLabel}
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </>
  );
}

/**
 * One person's line in that list.
 *
 * Two lines in the same 56px every other row on these screens stands at: the
 * padding is what the second line takes from the height, not something added
 * to it, so a row with no outcome to state is the same height as one with.
 */
export function SplitRow({
  name,
  tone,
  minorUnits,
  currency,
  figureLabel,
  outcome,
}: {
  name: string;
  tone: PersonTone;
  minorUnits: string;
  currency: string;
  /** Read before the figure, which on its own does not say what it is. */
  figureLabel: string;
  /** What this entry did to them, already worded; null when it moved nobody. */
  outcome: { text: string; tone: BalanceTone } | null;
}) {
  return (
    <li className="flex min-h-[56px] items-center gap-2.5 px-3.5 py-2">
      <PersonAvatar name={name} tone={tone} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2.5 text-sm font-semibold">
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="shrink-0 whitespace-nowrap">
            <span className="sr-only">{figureLabel} </span>
            <Amount minorUnits={minorUnits} currency={currency} />
          </span>
        </span>
        {outcome && (
          <span className={cn("text-xs font-medium", TONE[outcome.tone].ink)}>
            {outcome.text}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * One person's line in a repayment's "what this changed".
 *
 * A repayment has no shares to tabulate — it has two people and one figure —
 * so it states the consequence in words instead of in columns: where that
 * person stood without this payment, and where they stand now.
 *
 * "Now" is their balance in the group, and "before" is that balance with this
 * repayment taken back out of it. The engine adds transactions in no
 * particular order, so this is honestly "without this one" rather than a
 * snapshot of a moment in the past.
 */
export function ChangeRow({
  name,
  tone,
  before,
  minorUnits,
  currency,
  settledLabel,
  standingLabel,
}: {
  name: string;
  tone: PersonTone;
  /** Where they stood without this repayment, already worded. */
  before: string;
  /** Where they stand now. */
  minorUnits: string;
  currency: string;
  /** Replaces the figure when there is nothing left to settle. */
  settledLabel: string;
  /** "still owes" / "still gets back", under the figure. */
  standingLabel: string;
}) {
  const balance = BigInt(minorUnits);
  const magnitude = balance < 0n ? -balance : balance;

  return (
    <div className={ROW}>
      <PersonAvatar name={name} tone={tone} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{name}</span>
        {/* Wraps rather than truncating: it carries a figure, and on a narrow
            phone "Got back CHF 1,234.56 before this" lost its digits to an
            ellipsis. A name can be cut short; an amount cannot. */}
        <span className="text-2xs text-muted-foreground">{before}</span>
      </span>
      {balance === 0n ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-sm font-semibold",
            TONE.neutral.ink,
          )}
        >
          <Minus aria-hidden="true" className="size-[15px]" />
          {settledLabel}
        </span>
      ) : (
        <span className="flex shrink-0 flex-col items-end">
          <span
            className={cn(
              "flex items-center gap-1 text-sm font-semibold",
              TONE[toneFor(balance)].ink,
            )}
          >
            <span aria-hidden="true">{balance > 0n ? "+" : "−"}</span>
            <Amount minorUnits={magnitude.toString()} currency={currency} />
          </span>
          <span className="text-2xs text-muted-foreground">
            {standingLabel}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * An attachment.
 *
 * The trailing glyph is a download rather than the handoff's chevron, because
 * that is what a tap actually does: attachments are served with
 * `Content-Disposition: attachment` and a sandboxing CSP so a receipt can
 * never execute in the app's origin. There is no viewer to push onto.
 */
export function FileRow({
  href,
  name,
  meta,
}: {
  href: string;
  name: string;
  meta: string;
}) {
  return (
    <a
      href={href}
      download
      className={cn(
        ROW,
        "gap-3 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:bg-accent",
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-secondary text-muted-foreground">
        <FileGlyph />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="text-2xs text-muted-foreground">{meta}</span>
      </span>
      <Download
        aria-hidden="true"
        className="size-[18px] shrink-0 text-muted-foreground"
      />
    </a>
  );
}

/** The generic file mark, drawn once so both detail screens agree on it. */
function FileGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h6" />
    </svg>
  );
}

/**
 * The actions, docked above the group's navigation.
 *
 * Fixed rather than at the end of the column: on a transaction with several
 * people and a receipt the files are below the fold, and editing or removing
 * the entry should not be something you have to scroll past them to reach.
 *
 * The `5rem` is the bottom bar's own height, the same constant `Screen`'s
 * inset is built from. Nothing here is translucent — the bar is what content
 * scrolls under, and a blur would show the rows sliding behind the buttons.
 *
 * From `lg` up there is no bar, only the sidebar down the left, so the
 * actions dock at the foot of the window and start where the sidebar stops,
 * at whichever of its two widths it is; the inner column takes the screen's
 * own gutters there, so the buttons line up with the entry above them.
 */
export const ACTION =
  "inline-flex h-[46px] shrink-0 items-center justify-center gap-2 rounded-[13px] text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none";

/** Edit: outlined, and the only one of the two that takes the width. */
export const ACTION_NEUTRAL =
  "flex-1 border border-input bg-wash-2 active:bg-wash-3";

/** Remove: square, tinted, and carrying no border of its own. */
export const ACTION_DESTRUCTIVE =
  "size-[46px] bg-destructive/12 text-destructive active:bg-destructive/20";

export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 bg-background lg:bottom-0 lg:left-(--app-sidebar-w)">
      <div className="mx-auto flex w-full max-w-3xl gap-2 px-4 pt-2.5 pb-3.5 lg:px-6 xl:px-10">
        {children}
      </div>
    </div>
  );
}
