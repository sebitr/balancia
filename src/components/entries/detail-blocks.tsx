import { Download, Minus } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initialOf } from "./initials";
import { cn } from "@/lib/utils";
import { TONE, toneFor } from "@/components/money/balance-tone";

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

/** Which of the three a screen is. Decides the chip, and the amount's colour. */
export type EntryTone = "expense" | "revenue" | "settlement";

/**
 * Colour marks the exception. An expense is what an entry is unless it says
 * otherwise, so its chip is plum on plum and carries no tone of its own; the
 * red is in the figure under it, which is where the meaning lives. It used to
 * wear the accent, which put a coral chip above a coral-red figure and, with
 * a mint accent, a green expense chip beside the green income one.
 */
const CHIP_TONE: Record<EntryTone, string> = {
  expense: "bg-secondary text-secondary-foreground",
  revenue: "bg-positive/15 text-positive-ink",
  settlement: "bg-payer/15 text-payer-ink",
};

const DISC_TONE: Record<EntryTone, string> = {
  expense: "bg-foreground/12",
  revenue: "bg-positive/25",
  settlement: "bg-payer/25",
};

/**
 * A transfer is neither a gain nor a loss for the group, so it is the one
 * amount on these screens that carries no sign and no colour.
 */
const AMOUNT_TONE: Record<EntryTone, string> = {
  expense: "text-negative-ink",
  revenue: "text-positive-ink",
  settlement: "",
};

const AMOUNT_SIGN: Record<EntryTone, string> = {
  expense: "−",
  revenue: "+",
  settlement: "",
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
 * The figure the whole screen is about.
 *
 * The currency and the sign sit on the figure's baseline at a third of its
 * size: they qualify the number rather than compete with it. The sign is a
 * character rather than a colour, so "money went out" survives greyscale and
 * is read aloud — and it always leads, whichever end the currency is at.
 */
export function BigAmount({
  minorUnits,
  currency,
  tone,
  locale,
}: {
  minorUnits: string;
  currency: string;
  tone: EntryTone;
  /** The reader's number notation, which decides where the currency sits. */
  locale: string;
}) {
  const sign = AMOUNT_SIGN[tone];
  const leads = currencyLeads(locale, currency);
  const qualifier = (text: string) => (
    <span
      className={cn(
        "text-base font-medium",
        sign === "" ? "text-muted-foreground" : "opacity-75",
      )}
    >
      {text}
    </span>
  );

  return (
    <span
      className={cn(
        "flex items-baseline gap-2 leading-none",
        AMOUNT_TONE[tone],
      )}
    >
      {leads
        ? qualifier(sign === "" ? currency : `${sign} ${currency}`)
        : sign !== "" && qualifier(sign)}
      <span className="text-[40px] font-semibold tracking-[-0.03em]">
        <Amount minorUnits={minorUnits} currency={currency} display="none" />
      </span>
      {!leads && qualifier(currency)}
    </span>
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
 * The two-column table of who owes what.
 *
 * A real table rather than a row of flex columns: the header cells are what
 * make "96px" mean the same width on every row without each row being told,
 * and they are also the only way a screen reader can say which figure it is
 * reading. The name column takes what is left and truncates.
 */
export function PartyTable({
  personLabel,
  figureLabel,
  balanceLabel,
  children,
}: {
  /** Names the first column for assistive technology; the mock leaves it blank. */
  personLabel: string;
  figureLabel: string;
  /** Absent when this entry moved nobody's balance. */
  balanceLabel: string | null;
  children: React.ReactNode;
}) {
  const head =
    "h-8 border-b border-border pl-2.5 text-right text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="bg-foreground/[0.035]">
          <th scope="col" className="h-8 border-b border-border pl-3.5">
            <span className="sr-only">{personLabel}</span>
          </th>
          <th
            scope="col"
            className={cn(
              head,
              "min-w-[106px]",
              balanceLabel === null && "pr-3.5",
            )}
          >
            {figureLabel}
          </th>
          {balanceLabel !== null && (
            <th scope="col" className={cn(head, "min-w-[128px] pr-3.5")}>
              {balanceLabel}
            </th>
          )}
        </tr>
      </thead>
      <tbody className="[&>tr:not(:last-child)>*]:border-b [&>tr:not(:last-child)>*]:border-border">
        {children}
      </tbody>
    </table>
  );
}

/**
 * One person's line in that table.
 *
 * The signed figure and its colour carry the whole meaning of the balance
 * column, so there are no "owes" / "gets back" words beside them — but the
 * word is still there for anyone not reading the colour.
 */
export function PartyTableRow({
  name,
  tone,
  minorUnits,
  currency,
  balance,
}: {
  name: string;
  tone: PersonTone;
  minorUnits: string;
  currency: string;
  /** Null when the table has no balance column at all. */
  balance: { minorUnits: string; label: string } | null;
}) {
  const figure = "pl-2.5 text-right text-sm font-semibold whitespace-nowrap";
  const impact = balance === null ? 0n : BigInt(balance.minorUnits);
  const magnitude = impact < 0n ? -impact : impact;

  return (
    <tr className="h-14">
      <th scope="row" className="pl-3.5 text-left font-normal">
        <span className="flex min-w-0 items-center gap-2.5">
          <PersonAvatar name={name} tone={tone} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {name}
          </span>
        </span>
      </th>
      <td className={cn(figure, balance === null && "pr-3.5")}>
        <Amount minorUnits={minorUnits} currency={currency} />
      </td>
      {balance !== null && (
        <td className={cn(figure, "pr-3.5", TONE[toneFor(impact)].ink)}>
          <span aria-hidden="true">{impact < 0n ? "− " : "+ "}</span>
          <Amount minorUnits={magnitude.toString()} currency={currency} />
          <span className="sr-only"> {balance.label}</span>
        </td>
      )}
    </tr>
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
        <span className="truncate text-2xs text-muted-foreground">
          {before}
        </span>
      </span>
      {balance === 0n ? (
        <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-neutral-balance-ink">
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
 */
export const ACTION =
  "inline-flex h-[46px] shrink-0 items-center justify-center gap-2 rounded-[13px] text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none";

/** Edit: outlined, and the only one of the two that takes the width. */
export const ACTION_NEUTRAL =
  "flex-1 border border-input bg-foreground/5 active:bg-foreground/10";

/** Remove: square, tinted, and carrying no border of its own. */
export const ACTION_DESTRUCTIVE =
  "size-[46px] bg-destructive/12 text-destructive active:bg-destructive/20";

export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 bg-background">
      <div className="mx-auto flex w-full max-w-3xl gap-2 px-4 pt-2.5 pb-3.5">
        {children}
      </div>
    </div>
  );
}
