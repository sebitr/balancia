"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowDownLeft, ArrowUpRight, ReceiptText, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Amount } from "@/components/money/amount";
import { AddExpenseSheet, type PickableGroup } from "./add-expense-sheet";
import { cn } from "@/lib/utils";
import { currencyExponent } from "@/modules/currencies/iso-4217";
import { TONE, toneFor } from "@/components/money/balance-tone";

/**
 * "Where do I stand?", answered once for every group, at the top of the screen.
 *
 * This is the screen's only raised surface — everything below it sits flat on
 * the page — so it is a contained module with a hairline ring and a lit top
 * edge rather than a drop shadow. The screen has no page title of its own, so
 * a quiet label names the figure and doubles as the region's accessible name.
 *
 * The proportional rule is decorative and hidden from assistive technology;
 * the two totals underneath say the same thing in a form a screen reader can
 * read. Each is named by the column it sits in, so neither carries a sign —
 * direction is in the word above the number, never in colour alone. Those
 * columns exist only under a single converted total, which is the one figure
 * they can decompose into something it did not already say.
 *
 * A converted total is rounded to whole units. A rate has already been applied
 * to it, so centimes on a five-digit approximation are noise, and the exact
 * amount is a tap away inside the group that owes it. The per-currency figures
 * keep theirs: nothing was converted to reach them, each is the amount that
 * would actually settle that currency, and the header leads on one of them
 * precisely so it can be acted on.
 */

interface Figure {
  readonly minorUnits: string;
  readonly currency: string;
}

export interface PositionWidgetProps {
  /** Minor units, signed: positive means the user is owed overall. */
  readonly net: Figure | null;
  readonly owedToYou: Figure | null;
  readonly youOwe: Figure | null;
  /** Per-currency totals, shown when there is no rate to convert with. */
  readonly currencyTotals: readonly {
    currency: string;
    owedToYou: string;
    youOwe: string;
  }[];
  readonly displayCurrency: string | null;
  readonly ratesAsOf: string | null;
  /** `YYYY-MM-DD`, compared against `ratesAsOf` to phrase the disclosure. */
  readonly today: string;
  /** The same moment as an instant, for relative time. Pinned by the server. */
  readonly now: string;
  readonly converted: boolean;
  /** Every group the add-expense sheet can offer, most recently active first. */
  readonly groups: readonly PickableGroup[];
  readonly groupCount: number;
  readonly lastCleared: { at: string; groupName: string } | null;
}

/** One currency's standing: what it nets to, and which way. */
interface CurrencyNet {
  readonly currency: string;
  /** Signed minor units; positive means the reader is owed. */
  readonly net: bigint;
}

/**
 * The currencies with something outstanding, in the order the header reads
 * them.
 *
 * What the reader owes comes first — a debt is the fact they can act on, and
 * the header leads on it — and within a direction the largest amount comes
 * first. That size comparison is not a real one: there is no rate here, which
 * is the whole reason this header exists. It decides the order of the rows and
 * nothing else, and no figure derived for it is ever shown.
 *
 * The magnitudes are scaled to the widest exponent in the set before they are
 * compared, because minor units are not a common unit either: ¥1000 and €10.00
 * are both "1000" until they are.
 *
 * A currency that nets to zero is dropped. It is settled — the reader is owed
 * in one group exactly what they owe in another — and a "0" competes with the
 * lines that are not. When every one of them nets to zero the caller has
 * nothing left to lead on and says the word instead.
 */
function outstandingByCurrency(
  totals: PositionWidgetProps["currencyTotals"],
): CurrencyNet[] {
  const outstanding = totals
    .map((total) => ({
      currency: total.currency,
      net: BigInt(total.owedToYou) - BigInt(total.youOwe),
    }))
    .filter((entry) => entry.net !== 0n);

  const widest = outstanding.reduce(
    (digits, entry) => Math.max(digits, currencyExponent(entry.currency)),
    0,
  );
  const size = ({ currency, net }: CurrencyNet) =>
    (net < 0n ? -net : net) *
    10n ** BigInt(widest - currencyExponent(currency));
  const owing = ({ net }: CurrencyNet) => (net < 0n ? 0 : 1);

  return outstanding.sort((a, b) => {
    if (owing(a) !== owing(b)) return owing(a) - owing(b);
    const difference = size(b) - size(a);
    return difference === 0n ? 0 : difference < 0n ? -1 : 1;
  });
}

/**
 * Which way a balance runs, as a picture.
 *
 * Out of the reader's hands and up to the right when they owe; back down to
 * them when they are owed. It is one of three cues that say the same thing —
 * the arrow, the word beside it and the ink — so none of them is carrying the
 * meaning alone, and the figures themselves stay unsigned.
 */
function DirectionArrow({
  owed,
  className,
}: {
  owed: boolean;
  className?: string;
}) {
  const Glyph = owed ? ArrowDownLeft : ArrowUpRight;
  return <Glyph aria-hidden="true" className={cn("shrink-0", className)} />;
}

/**
 * The one figure the header leads on when there is no rate to combine the
 * currencies into one total.
 *
 * Every currency used to get a display-size numeral of its own, so an account
 * holding four of them arrived at four competing headlines, and the list of
 * groups underneath was pushed off the screen. One of them leads now and the
 * rest are rows: the reader still gets every figure, but only the one they can
 * act on is sized like an answer.
 *
 * Spans throughout, because this sits inside the button that opens its
 * footnote, and a button holds phrasing content only.
 */
function LeadFigure({ entry }: { entry: CurrencyNet }) {
  const t = useTranslations("dashboard");
  const owed = entry.net > 0n;
  const magnitude = entry.net < 0n ? -entry.net : entry.net;

  return (
    <span className="flex flex-col gap-1">
      <span
        className={cn("flex items-center gap-2", TONE[toneFor(entry.net)].ink)}
      >
        <DirectionArrow owed={owed} className="size-[26px]" />
        {/* Steps down rather than wrapping mid-number where the screen is
            narrower than the 376px this was drawn at. */}
        <Amount
          minorUnits={magnitude.toString()}
          currency={entry.currency}
          signDisplay="never"
          className="text-[2.125rem] leading-[1.05] font-semibold tracking-[-0.02em] max-[359px]:text-[1.75rem]"
        />
      </span>
      {/* Indented to the figure, so the word reads as its caption rather than
          as the first of the rows below it. */}
      <span className="block pl-[34px] text-xs text-muted-foreground">
        {owed ? t("wordOwedToYou") : t("wordYouOwe")}
      </span>
    </span>
  );
}

/**
 * The currencies the header did not lead on, one compact line each.
 *
 * A row says the same three things the headline does — direction as an arrow,
 * as a word and as ink, then the amount — at the size of a list rather than of
 * an answer. Nothing here is a link: a currency is not a screen, and the
 * groups behind it are already listed below.
 */
function CurrencyRows({ entries }: { entries: readonly CurrencyNet[] }) {
  const t = useTranslations("dashboard");

  return (
    <ul className="flex flex-col gap-0.5 border-t pt-3">
      {entries.map((entry) => {
        const owed = entry.net > 0n;
        const ink = TONE[toneFor(entry.net)].ink;
        const magnitude = entry.net < 0n ? -entry.net : entry.net;
        return (
          <li
            key={entry.currency}
            className="flex items-center justify-between gap-3 py-[7px]"
          >
            <span className="flex items-center gap-[7px] text-xs text-muted-foreground">
              <DirectionArrow owed={owed} className={cn("size-[15px]", ink)} />
              {owed ? t("wordOwedToYou") : t("wordYouOwe")}
            </span>
            <Amount
              minorUnits={magnitude.toString()}
              currency={entry.currency}
              signDisplay="never"
              className={cn("text-base font-semibold", ink)}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A figure that opens its own footnote.
 *
 * The widget shows a total without saying how it got there — a standing line
 * under every balance is noise on the days nothing has moved — but the
 * disclosure is not allowed to disappear, so the figure itself opens it. The
 * converted total explains its rate this way; the per-currency figures
 * explain why there is more than one of them.
 */
function FigureDisclosure({
  label,
  note,
  children,
}: {
  /** What the tap does, for a screen reader; the figures are the visible name. */
  label: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger className="self-start rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        {children}
        <span className="sr-only">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[17rem]">
        <p className="text-muted-foreground">{note}</p>
      </PopoverContent>
    </Popover>
  );
}

/** Flex weights, so the two segments read as a proportion rather than a scale. */
function shareOf(a: bigint, b: bigint): [number, number] {
  if (a + b === 0n) return [1, 1];
  return [Number(a), Number(b)];
}

export function PositionWidget({
  net,
  owedToYou,
  youOwe,
  currencyTotals,
  displayCurrency,
  ratesAsOf,
  today,
  now,
  converted,
  groups,
  groupCount,
  lastCleared,
}: PositionWidgetProps) {
  const t = useTranslations("dashboard");
  const tMoney = useTranslations("money");
  const format = useFormatter();
  const [picking, setPicking] = useState(false);
  const labelId = useId();

  const netUnits = net ? BigInt(net.minorUnits) : null;
  const positive = netUnits !== null && netUnits > 0n;

  const outstanding = outstandingByCurrency(currencyTotals);
  const [lead, ...rest] = outstanding;

  /*
   * Three states, and they are not the same absence. Square everywhere is a
   * result and gets the word; a missing rate is a failure and gets the
   * per-currency figures, with the reason a tap behind them. An account
   * holding no balance at all reaches the first through `currencyTotals`
   * being empty rather than through a zero — and so does one whose currencies
   * each net out on their own, which is settled by another name.
   *
   * The totals band only follows a single converted figure. Under the
   * per-currency figures it had nothing to add: each currency nets in one
   * direction, so every row of it was the figure above beside a zero.
   */
  const allSquare =
    (netUnits !== null && netUnits === 0n) ||
    (net === null && outstanding.length === 0);
  const ratesUnavailable = net === null && outstanding.length > 0;
  const showTotals = !allSquare && net !== null;

  /** The rate the figure was converted at, phrased for the day it is from. */
  const disclosure =
    converted && displayCurrency && !allSquare
      ? ratesAsOf === today
        ? t("convertedToday", { currency: displayCurrency })
        : t("convertedOn", {
            currency: displayCurrency,
            date: ratesAsOf ?? today,
          })
      : null;

  const figure =
    net && netUnits !== null ? (
      <Amount
        minorUnits={(netUnits < 0n ? -netUnits : netUnits).toString()}
        currency={net.currency}
        fractionDigits={0}
        className={cn(
          "text-[2.875rem] leading-none font-semibold tracking-[-0.035em]",
          TONE[positive ? "positive" : "negative"].ink,
        )}
      />
    ) : null;

  return (
    <section
      aria-labelledby={labelId}
      className="overflow-hidden rounded-[20px] bg-card shadow-[inset_0_1px_0_0_var(--border)] ring-1 ring-foreground/10"
    >
      <div className="flex flex-col gap-[18px] px-[18px] pt-5 pb-4">
        {/* The label names the region as well as the figure, and the badge
            beside it says how many currencies are in play — the one number
            that would otherwise have to be counted off the rows. It is never a
            total: these currencies are not added up anywhere. */}
        <div className="flex items-center justify-between gap-2.5">
          <p
            id={labelId}
            className="text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
          >
            {t("positionEyebrow")}
          </p>
          {ratesUnavailable && outstanding.length > 1 && (
            <Badge variant="secondary" className="shrink-0 text-2xs">
              {t("currencyCount", { count: outstanding.length })}
            </Badge>
          )}
        </div>

        {allSquare ? (
          <p
            className={cn(
              "text-[1.875rem] font-semibold tracking-[-0.025em]",
              TONE.neutral.ink,
            )}
          >
            {tMoney("settledUpBadge")}
          </p>
        ) : ratesUnavailable && lead ? (
          <FigureDisclosure
            label={t("perCurrencyDisclosureLabel")}
            note={t("ratesUnavailable")}
          >
            <LeadFigure entry={lead} />
          </FigureDisclosure>
        ) : disclosure ? (
          <FigureDisclosure label={t("rateDisclosureLabel")} note={disclosure}>
            {figure}
          </FigureDisclosure>
        ) : (
          figure
        )}

        {ratesUnavailable && rest.length > 0 && <CurrencyRows entries={rest} />}

        {showTotals && (
          <>
            {net && owedToYou && youOwe && (
              <div aria-hidden="true" className="flex h-[3px] gap-0.5">
                {(() => {
                  const [owed, owing] = shareOf(
                    BigInt(owedToYou.minorUnits),
                    BigInt(youOwe.minorUnits),
                  );
                  return (
                    <>
                      {owed > 0 && (
                        <span
                          style={{ flexGrow: owed }}
                          className={cn("rounded-full", TONE.positive.fill)}
                        />
                      )}
                      {owing > 0 && (
                        <span
                          style={{ flexGrow: owing }}
                          className={cn("rounded-full", TONE.negative.fill)}
                        />
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            <div className="-mt-2 grid grid-cols-2">
              <TotalsColumn label={t("owedToYouLabel")}>
                {owedToYou && (
                  <TintedTotal
                    minorUnits={owedToYou.minorUnits}
                    currency={owedToYou.currency}
                    tone="positive"
                  />
                )}
              </TotalsColumn>
              <TotalsColumn label={t("youOweLabel")} divided>
                {youOwe && (
                  <TintedTotal
                    minorUnits={youOwe.minorUnits}
                    currency={youOwe.currency}
                    tone="negative"
                  />
                )}
              </TotalsColumn>
            </div>
          </>
        )}

        {allSquare && (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            {lastCleared
              ? t("nothingOutstandingSince", {
                  groups: groupCount,
                  when: format.relativeTime(
                    new Date(lastCleared.at),
                    new Date(now),
                  ),
                  group: lastCleared.groupName,
                })
              : t("nothingOutstanding", { groups: groupCount })}
          </p>
        )}
      </div>

      {/* Its own strip on a lighter fill, so the actions read as part of the
          widget rather than as buttons floating inside it. */}
      {/* Each button carries the glyph the app already uses for the thing it
          makes — the receipt of the group's empty state, the people of a
          group — rather than the plus both wore, which said "add" twice and
          told the eye nothing about which one. The verb moved into the label.
          That makes the labels longer, so the row wraps rather than
          overflowing and each button takes the whole of whatever line it
          lands on: "Ajouter une dépense" and "Nouveau groupe" do not fit side
          by side on any phone, so French reads as two full-width rows where
          English stays one. Natural widths come back at the desk. */}
      <div className="flex flex-wrap items-center gap-2 border-t bg-[color-mix(in_oklch,var(--muted)_45%,transparent)] px-[18px] py-[13px]">
        {/* 44px in the hand, 34 at the desk. This is the app's primary action
            and it was 34px tall on a phone — inside its target once
            `tap-target` is on it, but still drawn smaller than the rows of
            groups underneath it, which is the wrong way round for the one
            button most people came to press. */}
        <Button
          type="button"
          onClick={() => setPicking(true)}
          className="h-11 grow rounded-xl px-[13px] py-[5px] text-sm md:h-[34px] md:grow-0"
        >
          <ReceiptText aria-hidden="true" className="size-[15px]" />
          {t("addExpense")}
        </Button>
        {/* Creating a group is a key action, so it reads as the second of two
            buttons — the border is deliberately stronger than `--input`, which
            is tuned for form fields at rest. */}
        <Button
          asChild
          variant="outline"
          className="h-11 grow rounded-xl border-foreground/25 bg-wash-2 px-[13px] py-[5px] text-sm md:h-[34px] md:grow-0 dark:border-foreground/25 dark:bg-wash-2"
        >
          {/* Opens the create sheet on this page rather than pushing a screen. */}
          <Link href="?new" replace scroll={false}>
            <Users aria-hidden="true" className="size-[15px]" />
            {t("newGroup")}
          </Link>
        </Button>
      </div>

      <AddExpenseSheet
        open={picking}
        onOpenChange={setPicking}
        groups={groups}
        now={now}
      />
    </section>
  );
}

function TotalsColumn({
  label,
  divided,
  children,
}: {
  label: string;
  divided?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-[3px] pt-3 pb-0.5",
        divided && "border-l pl-4",
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function TintedTotal({
  minorUnits,
  currency,
  tone,
}: {
  minorUnits: string;
  currency: string;
  tone: "positive" | "negative";
}) {
  return (
    <span className={cn("text-sm font-medium", TONE[tone].ink)}>
      <Amount minorUnits={minorUnits} currency={currency} fractionDigits={0} />
    </span>
  );
}
