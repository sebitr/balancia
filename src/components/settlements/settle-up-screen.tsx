"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Info,
  Receipt,
} from "lucide-react";
import { Amount } from "@/components/money/amount";
import type { PayoutMethodChoice } from "@/components/payouts/payout-hint";
import type {
  PaymentQrRefusal,
  PaymentQrStandard,
} from "@/modules/payouts/qr/payment-qr";
import { settleIntentPath } from "@/components/entries/settle-intent";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { remindRecipientsFor, SettleActions } from "./settle-actions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { RemindRecipient } from "@/modules/reminders/types";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";
import { TONE, type BalanceTone } from "@/components/money/balance-tone";

/**
 * Settle up: the shortest set of transfers that clears the group.
 *
 * The amount comes first. A reader arriving here is holding one question —
 * *how much, and to whom* — and the screen answers it in that order: a hero
 * that states their own outstanding position, a bar that says what it is made
 * of, and only then the payments, as flat rows rather than a stack of cards.
 * Each row is one line and one action, and the way to actually hand the money
 * over sits inside the row that owes it.
 *
 * Balancia never moves money, so the actions are only ever *record it* and
 * *ask for it*, and both hand off to the flows that already own those jobs
 * rather than growing a second form here.
 *
 * Four rules the screen keeps to:
 *
 *  - **Currencies never meet.** A separate-currency group gets one hero and
 *    one set of rows per currency, and a currency that is square says
 *    "settled up" instead of showing 0.00.
 *  - **Direction is said three ways** — the eyebrow above the hero, an arrow,
 *    and the colour — so it survives greyscale and a screen reader, per the
 *    design system's money rules.
 *  - **The bar is a money surface**, so its segments take their fill from
 *    `TONE` and never from the accent. `AGENTS.md` explains why that rule
 *    exists and why it beats a handoff that says otherwise.
 *  - **Nobody nudges on someone else's behalf.** Rows between two other people
 *    can be recorded, never reminded; see `modules/reminders/service`.
 */

export interface SettleUpTransferView {
  readonly fromParticipantId: string;
  readonly fromName: string;
  readonly toParticipantId: string;
  readonly toName: string;
  readonly currency: string;
  /** Minor units as a string, always positive. */
  readonly minorUnits: string;
  readonly fromIsSelf: boolean;
  readonly toIsSelf: boolean;
}

export interface SettleUpCurrencyView {
  readonly currency: string;
  readonly yours: readonly SettleUpTransferView[];
  readonly others: readonly SettleUpTransferView[];
}

export interface SettledRepaymentView {
  readonly id: string;
  readonly fromName: string;
  readonly toName: string;
  readonly currency: string;
  readonly minorUnits: string;
  readonly settledOn: string;
  readonly paymentMethod: string | null;
}

/** Every way one person accepts money, for the row that owes them. */
export interface PayoutHintView {
  readonly participantId: string;
  /**
   * The currency of the debt this hint belongs to. Part of the key rather than
   * decoration: a reader can owe one person in two currencies, and the two
   * rows are two different payments with two different codes.
   */
  readonly currency: string;
  /**
   * In the owner's own order — `payoutMethods.position` — so the first is the
   * one they would rather have and the rest are the alternatives they are
   * willing to take. Never empty: a participant with nothing listed produces
   * no hint at all.
   */
  readonly methods: readonly PayoutMethodChoice[];
  /**
   * The leading payment code, built on the server because only the server
   * holds the creditor's address.
   *
   * Each entry in `methods` now carries its own code, and this is whichever of
   * them is the first to have one — so it is what the row shows before the
   * reader picks a chip, and not a separate answer. Null whenever no method
   * can produce a code correctly, which is still the common case.
   */
  readonly qr: { standard: PaymentQrStandard; payload: string } | null;
  /**
   * Why there is no code, when it is a reason the reader can act on. Null
   * both when there is a code and when the reason is not worth a sentence.
   */
  readonly qrMissing: PaymentQrRefusal | null;
}

interface Shared {
  readonly groupId: string;
  readonly groupName: string;
  readonly senderName: string;
  readonly recipients: readonly RemindRecipient[];
  readonly currencyMode: "separate" | "converted";
  readonly baseCurrency: string | null;
  /**
   * Only ever the people this reader owes. The page collects them from the
   * transfers it has already computed, so there is no way to ask about anybody
   * else — which is the whole of the rule that payout details are visible to
   * the people who owe you and to nobody else.
   */
  readonly payoutHints: readonly PayoutHintView[];
}

export function SettleUpScreen({
  currencies,
  transferCount,
  lastSettled,
  ...shared
}: Shared & {
  currencies: readonly SettleUpCurrencyView[];
  transferCount: number;
  lastSettled: readonly SettledRepaymentView[];
}) {
  const t = useTranslations("settleUp");

  /* Which sentence counts the plan. One currency is the whole of it and says
     so; several can only ever be counted apart, because there is no number
     that covers two currencies without adding them together. */
  const countsWholePlan = currencies.length === 1;
  const section = (entry: SettleUpCurrencyView) => (
    <CurrencySection
      key={entry.currency}
      entry={entry}
      countsWholePlan={countsWholePlan}
      {...shared}
    />
  );
  const [first, ...rest] = currencies;

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t("title")}
        back={{
          href: `/groups/${shared.groupId}`,
          label: t("backToGroup"),
        }}
        /* On a desk the currencies stand side by side, so the screen says
           once, above them, why each column speaks only for itself. It does
           not count the whole plan there, as the desktop board drew it: see
           `countsWholePlan` — each column counts its own. */
        meta={
          transferCount > 0 && !countsWholePlan
            ? t("eachCurrencyApart")
            : undefined
        }
      />

      {transferCount === 0 ? (
        <NothingToSettle groupId={shared.groupId} lastSettled={lastSettled} />
      ) : (
        /*
         * One column per currency from `lg` (board 17), so a debt in francs is
         * never below the fold of a credit in euros. The first currency on the
         * left; the rest, and the note on how a repayment works, on the right
         * — which keeps the document in the order a phone reads it, where the
         * currencies stack one under another and the note is not drawn.
         *
         * Each column is about a phone's width at 1024px, which is the width
         * these rows were drawn for; nothing inside a column changes.
         */
        <div
          data-layout="wide"
          className="flex flex-col lg:mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6"
        >
          <div className="flex min-w-0 flex-col lg:gap-6">
            {first && section(first)}
          </div>
          <div className="flex min-w-0 flex-col lg:gap-6">
            {rest.map(section)}
            <p className="hidden gap-2.5 rounded-[14px] bg-wash-1 px-4 py-3.5 text-sm text-muted-foreground lg:flex">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t("howRepaymentsWork")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One currency: where the reader stands in it, and what to do about it.
 *
 * A group balancing in three currencies gets three of these, one under
 * another, each with its own hero — which is the only honest way to state a
 * position that cannot be totalled. From `lg` the first stands beside the
 * rest rather than above them, each in a card of its own.
 */
function CurrencySection({
  entry,
  countsWholePlan,
  ...shared
}: Shared & { entry: SettleUpCurrencyView; countsWholePlan: boolean }) {
  const t = useTranslations("settleUp");
  const count = entry.yours.length + entry.others.length;

  if (count === 0) {
    return (
      <section className="mt-4 flex items-center justify-between gap-3 rounded-[18px] bg-card px-4 py-4 ring-1 ring-border lg:mt-0 lg:px-5">
        <h2 className="text-2xs font-bold tracking-[0.1em] uppercase">
          {entry.currency}
        </h2>
        {/* Never `0.00`: a currency nobody owes anything in has no amount, and
            printing one invites the reader to look for what it refers to. */}
        <p className="text-sm font-medium text-neutral-balance-ink">
          {t("settledUp")}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`settle-${entry.currency}`}
      /* A card from `lg`, where two of these stand side by side and each needs
         an edge; on a phone the screen is the one column and has no cards. */
      className="flex flex-col lg:relative lg:rounded-[18px] lg:bg-card lg:px-5 lg:pb-2 lg:ring-1 lg:ring-border"
    >
      {/* Read out, never seen, on a phone: the hero's own figure names its
          currency. Beside a second column it is that column's heading, so
          from `lg` it is drawn in the card's corner, opposite the eyebrow. */}
      <h2
        id={`settle-${entry.currency}`}
        className="max-lg:sr-only lg:absolute lg:top-5 lg:right-5 lg:rounded-full lg:px-2 lg:py-0.5 lg:text-2xs lg:font-bold lg:tracking-[0.1em] lg:text-muted-foreground lg:uppercase lg:ring-1 lg:ring-border"
      >
        {entry.currency}
      </h2>

      <Hero entry={entry} countsWholePlan={countsWholePlan} count={count} />

      {entry.yours.length > 0 && (
        <>
          <Rule />
          {/* Named on a desk, where the other people's payments are named
              too and the card is wide enough to need a heading per part. */}
          <Eyebrow className="hidden pt-4 pb-1 lg:block">{t("barYou")}</Eyebrow>
          {entry.yours.map((transfer, index) => (
            <PaymentBlock
              key={rowKey(transfer)}
              transfer={transfer}
              first={index === 0}
              {...shared}
            />
          ))}
        </>
      )}

      {entry.others.length > 0 && (
        <>
          <Rule className="mt-6" />
          <Eyebrow className="pt-4 pb-1">{t("notYourConcern")}</Eyebrow>
          {entry.others.map((transfer) => (
            <TheirRow
              key={rowKey(transfer)}
              transfer={transfer}
              groupId={shared.groupId}
            />
          ))}
        </>
      )}
    </section>
  );
}

/**
 * The screen's own divider, drawn to both edges.
 *
 * The gutter belongs to the words, not to the rule: a line that stops 16px
 * short reads as the edge of a card, and there are no cards on this screen any
 * more.
 */
function Rule({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("-mx-4 border-t lg:-mx-5", className)}
    />
  );
}

function Eyebrow({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <p
      id={id}
      className={cn(
        "text-2xs font-semibold tracking-[0.1em] text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * How much, which way, and what it is made of.
 *
 * The figure is the reader's own net position in this currency — not the total
 * of the plan, which includes payments they are neither making nor receiving.
 * The bar underneath is the plan: one segment per payment of theirs, then one
 * for everything between other people, so the difference between "my share"
 * and "the whole thing" is visible rather than asserted.
 *
 * The eyebrow is not decoration. It is the word half of the direction, which
 * the colour and the arrow say the other two ways — and it is the half that
 * survives a screen reader and a greyscale screen.
 */
function Hero({
  entry,
  countsWholePlan,
  count,
}: {
  entry: SettleUpCurrencyView;
  countsWholePlan: boolean;
  count: number;
}) {
  const t = useTranslations("settleUp");

  const outgoing = entry.yours.filter((transfer) => transfer.fromIsSelf);
  const incoming = entry.yours.filter((transfer) => transfer.toIsSelf);
  const net = total(incoming) - total(outgoing);

  const tone: BalanceTone =
    net > 0n ? "positive" : net < 0n ? "negative" : "neutral";
  const magnitude = net < 0n ? -net : net;

  /*
   * The sub-line answers "and then what". One debt owed to the reader is
   * waiting on one person, so it names them; anything else is a plan, and a
   * plan is counted.
   */
  const single = entry.yours.length === 1 ? entry.yours[0] : null;
  const subline =
    single && single.toIsSelf
      ? t("personStillOwesYou", { name: single.fromName })
      : countsWholePlan
        ? t("clearsGroup", { count })
        : t("clearsCurrency", { count });

  return (
    <div className="flex flex-col gap-2.5 pt-4 pb-4 lg:pt-5">
      <div className="flex flex-col gap-1">
        <Eyebrow>
          {tone === "positive"
            ? t("heroReceiving")
            : tone === "negative"
              ? t("heroOwing")
              : t("heroBalance")}
        </Eyebrow>

        <p className={cn("flex items-center gap-1.5", TONE[tone].ink)}>
          {tone === "negative" && (
            <ArrowUpRight aria-hidden="true" className="size-[22px]" />
          )}
          {tone === "positive" && (
            <ArrowDownLeft aria-hidden="true" className="size-[22px]" />
          )}
          {/* A display numeral at a desk, the board's 36px: the one figure
              each column is about, read from further away than a phone. */}
          <Amount
            minorUnits={magnitude.toString()}
            currency={entry.currency}
            className="text-2xl font-semibold tracking-[-0.02em] lg:text-[2.25rem] lg:leading-tight"
          />
        </p>
      </div>

      <p className="text-xs text-muted-foreground">{subline}</p>

      <CompositionBar entry={entry} />
    </div>
  );
}

/** One segment of the plan: how big it is, what colour says so, and its name. */
interface Segment {
  readonly key: string;
  readonly label: string;
  readonly minorUnits: bigint;
  readonly fill: string;
}

/**
 * What the plan is made of, as one bar and its legend.
 *
 * Drawn only when there is more than one thing in it. A single segment is a
 * full-width block that says exactly what the figure above it already said,
 * and a legend of one is a label for a thing that has no alternative.
 *
 * The reader's own payments alternate between the tone's fill and its ink —
 * two tokens `token-contrast.test.ts` already holds to a ratio — so two debts
 * in the same direction can be told apart without reaching for the accent,
 * which `AGENTS.md` keeps off money surfaces. Everything between other people
 * is one neutral segment: it is not the reader's direction, and it is not
 * theirs to break down.
 */
function CompositionBar({ entry }: { entry: SettleUpCurrencyView }) {
  const t = useTranslations("settleUp");

  const mine = entry.yours.map((transfer, index): Segment => {
    const own: BalanceTone = transfer.fromIsSelf ? "negative" : "positive";
    return {
      key: rowKey(transfer),
      // With one payment of their own, naming the other party would only
      // repeat the row directly beneath it; with several, the name is the
      // whole point of the legend.
      label:
        entry.yours.length === 1
          ? t("barYou")
          : transfer.fromIsSelf
            ? transfer.toName
            : transfer.fromName,
      minorUnits: BigInt(transfer.minorUnits),
      fill: index % 2 === 0 ? TONE[own].fill : INK_FILL[own],
    };
  });

  const rest = total(entry.others);
  const segments: Segment[] = [
    ...mine,
    ...(rest > 0n
      ? [
          {
            key: "others",
            label: t("betweenOthers"),
            minorUnits: rest,
            fill: NOT_MINE_FILL,
          },
        ]
      : []),
  ];

  if (segments.length < 2) return null;

  return (
    <div className="flex flex-col gap-1.5 pt-0.5">
      <div className="flex h-[9px] gap-[3px]" aria-hidden="true">
        {segments.map((segment) => (
          <span
            key={segment.key}
            // Grown by size rather than sized by percentage: the segments and
            // the gaps between them share one row, and flex is the only thing
            // that can divide what is left after the gaps.
            style={{ flexGrow: Number(segment.minorUnits) }}
            className={cn("min-w-1 rounded-full", segment.fill)}
          />
        ))}
      </div>

      {/* The legend is the bar in words, so it carries the figures the bar can
          only imply — and it is what a screen reader gets, the bar itself
          being a picture of these same numbers. */}
      <ul className="flex flex-wrap justify-between gap-x-3 gap-y-1">
        {segments.map((segment) => (
          <li
            key={segment.key}
            className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className={cn(
                "mr-0.5 size-[7px] shrink-0 rounded-full",
                segment.fill,
              )}
            />
            <span className="truncate">{segment.label}</span>
            <Amount
              minorUnits={segment.minorUnits.toString()}
              currency={entry.currency}
              display="none"
              className="shrink-0"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The ink of a tone, as a fill.
 *
 * `TONE` names its ink as a text class because that is what an ink is for.
 * Here it is the second shade of one direction, and only the two tokens
 * already checked for contrast are allowed to be it.
 */
const INK_FILL: Record<"positive" | "negative", string> = {
  positive: "bg-positive-ink",
  negative: "bg-negative-ink",
};

/**
 * The segment that is not the reader's money.
 *
 * `TONE.neutral.fill` lightened, and written out in full because Tailwind
 * reads class names out of the source: a string built at run time is a class
 * nothing generated. At full weight it competed with the segment beside it for
 * the eye, on a bar whose whole job is to say which part is theirs.
 */
const NOT_MINE_FILL = "bg-neutral-balance/45";

function total(transfers: readonly SettleUpTransferView[]): bigint {
  return transfers.reduce(
    (sum, transfer) => sum + BigInt(transfer.minorUnits),
    0n,
  );
}

function rowKey(transfer: SettleUpTransferView): string {
  return `${transfer.fromParticipantId}-${transfer.toParticipantId}-${transfer.currency}-${transfer.minorUnits}`;
}

/**
 * One payment the reader is in: the line, and the one thing to do about it.
 *
 * A row, not a card. The screen already has a card's worth of hierarchy at the
 * top of it, and stacking two or three more under that turned a list of two
 * payments into a scroll. What separates them is a rule.
 */
function PaymentBlock({
  transfer,
  first,
  ...shared
}: Shared & { transfer: SettleUpTransferView; first: boolean }) {
  const t = useTranslations("settleUp");
  const format = useFormatter();

  // The face is the other party: on this row the reader is always one of the
  // two, and their own initials would say nothing.
  const face = transfer.fromIsSelf ? transfer.toName : transfer.fromName;

  const reminded = remindRecipientsFor(transfer, shared.recipients).find(
    (recipient) => recipient.lastRemindedAt !== null,
  )?.lastRemindedAt;

  return (
    <div className={cn("flex flex-col gap-3.5 py-4", !first && "border-t")}>
      <div className="flex items-center gap-3">
        <Avatar className="size-10 shrink-0">
          <AvatarFallback className="bg-accent text-sm font-semibold text-accent-foreground">
            {initialsOf(face)}
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-col gap-0.5">
          {/* The row is an instruction, not a report: "Pay Hervé back" is what
              the reader came to do, where "Seb pays Hervé" made them work out
              which of the two names was theirs. */}
          <p className="truncate text-base font-semibold tracking-[-0.01em]">
            {transfer.fromIsSelf
              ? t("payBack", { name: transfer.toName })
              : t("personRepaysYou", { name: transfer.fromName })}
          </p>
          {reminded && (
            <p className="truncate text-xs text-muted-foreground">
              {t("remindedWhen", {
                when: format.relativeTime(new Date(reminded)),
              })}
            </p>
          )}
        </div>

        {/* No arrow here. The hero above already said which way the money
            goes, and a second arrow per row turns a statement into a pattern
            the eye stops reading. */}
        <Amount
          minorUnits={transfer.minorUnits}
          currency={transfer.currency}
          className={cn(
            "ml-auto shrink-0 text-xl font-semibold tracking-[-0.01em]",
            TONE[transfer.fromIsSelf ? "negative" : "positive"].ink,
          )}
        />
      </div>

      {/* The one thing to do about it — shared with a person's own page,
          which offers the same payment from the other direction. */}
      <SettleActions
        transfer={transfer}
        groupId={shared.groupId}
        groupName={shared.groupName}
        senderName={shared.senderName}
        recipients={shared.recipients}
        payoutHints={shared.payoutHints}
      />
    </div>
  );
}

/**
 * A payment between two other people.
 *
 * Nothing on it is copyable, nothing about it can be chased, and the one thing
 * it offers — recording that they squared up — used to be a small button off
 * to the right with sixty pixels of dead row beside it. The sentence is what
 * the reader aims at, so the sentence is the button.
 */
function TheirRow({
  transfer,
  groupId,
}: {
  transfer: SettleUpTransferView;
  groupId: string;
}) {
  const t = useTranslations("settleUp");

  const recordHref = settleIntentPath(groupId, {
    fromParticipantId: transfer.fromParticipantId,
    toParticipantId: transfer.toParticipantId,
    currency: transfer.currency,
    method: null,
  });

  return (
    <Link
      href={recordHref}
      // Two stacked lines in one control run together into "Poul pays
      // SebRecord for them" for a screen reader, so the row states its own
      // name rather than being read out of its parts.
      aria-label={t("recordFor", {
        from: transfer.fromName,
        to: transfer.toName,
      })}
      className="-mx-2 flex min-h-14 items-center gap-3 rounded-[14px] px-2 transition-colors hover:bg-wash-1"
    >
      <Avatar className="size-8 shrink-0 opacity-60">
        <AvatarFallback className="bg-accent text-2xs font-semibold text-accent-foreground">
          {initialsOf(transfer.fromName)}
        </AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-col">
        <p className="truncate text-sm font-medium text-secondary-foreground">
          {t("paysSentence", {
            from: transfer.fromName,
            to: transfer.toName,
          })}
        </p>
        <p className="truncate text-2xs text-muted-foreground">
          {t("recordForThem")}
        </p>
      </div>

      <Amount
        minorUnits={transfer.minorUnits}
        currency={transfer.currency}
        className="ml-auto shrink-0 text-sm font-semibold text-neutral-balance-ink"
      />
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}

/**
 * Nothing owed anywhere.
 *
 * A state, not a list of zeros. The card says the group is done and offers the
 * one thing there is left to do with it — read what happened — and the last
 * repayments sit under it as the evidence, read-only.
 */
function NothingToSettle({
  groupId,
  lastSettled,
}: {
  groupId: string;
  lastSettled: readonly SettledRepaymentView[];
}) {
  const t = useTranslations("settleUp");

  return (
    <>
      <section className="mt-6 flex flex-col items-center gap-3 rounded-[22px] bg-card px-5 py-8 text-center ring-1 ring-foreground/10">
        <span className="flex size-13 items-center justify-center rounded-full bg-positive/15 text-positive-ink">
          <Check aria-hidden="true" className="size-6.5" strokeWidth={2.6} />
        </span>
        <h2 className="text-xl font-semibold tracking-[-0.02em]">
          {t("allSettledTitle")}
        </h2>
        <p className="max-w-[28ch] text-xs text-pretty text-muted-foreground">
          {t("allSettledDescription")}
        </p>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="mt-1 h-[46px] rounded-[14px] px-4.5 font-semibold"
        >
          <Link href={`/groups/${groupId}/expenses`} transitionTypes={PUSH}>
            <Receipt aria-hidden="true" className="size-4" />
            {t("seeTransactions")}
          </Link>
        </Button>
      </section>

      {lastSettled.length > 0 && (
        <section aria-labelledby="last-settled" className="mt-10">
          <Eyebrow className="pb-1" id="last-settled">
            {t("lastSettled")}
          </Eyebrow>
          <ul>
            {lastSettled.map((repayment) => (
              <li
                key={repayment.id}
                className="flex min-h-12 items-center gap-3"
              >
                <Avatar className="size-8 shrink-0 opacity-60">
                  <AvatarFallback className="bg-accent text-2xs font-semibold text-accent-foreground">
                    {initialsOf(repayment.fromName)}
                  </AvatarFallback>
                </Avatar>
                <p className="min-w-0 truncate text-sm font-medium text-secondary-foreground">
                  {t("paidSentence", {
                    from: repayment.fromName,
                    to: repayment.toName,
                  })}
                </p>
                <Amount
                  minorUnits={repayment.minorUnits}
                  currency={repayment.currency}
                  className="ml-auto shrink-0 text-sm font-semibold text-neutral-balance-ink"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Up to two letters, from the first two words of a name.
 *
 * A one-word display name gives one letter, which is what the rest of the app
 * shows; a name with a surname gives both, which is what tells two Jonases
 * apart in a group that has them.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("");
}
