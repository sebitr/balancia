"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ReceiptText, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Amount } from "@/components/money/amount";
import { AddExpenseSheet, type PickableGroup } from "./add-expense-sheet";
import { cn } from "@/lib/utils";
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
 * Every figure here is rounded to whole units. This is an answer to "roughly
 * where do I stand?", and centimes on a five-digit total are noise; the exact
 * amount is a tap away, inside the group that owes it.
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

/**
 * The position, one figure per currency, when there is no rate to combine them.
 *
 * These are not a consolation for the missing total — they are the position,
 * and there is nothing approximate about them. Nothing sits under them. The
 * "owed to you / you owe" columns that follow a converted total would only
 * repeat each figure beside a zero here, since a currency's net has one
 * direction; and the sentence that used to explain why there is more than one
 * figure spent a line of the screen apologising for a rate the instance never
 * had. An instance that took the defaults never turns rate suggestions on, so
 * for anyone holding two currencies that line was not an edge case; it was
 * the header. The explanation is a tap away instead, behind the figures
 * themselves, the way the conversion disclosure already is.
 *
 * A currency that nets to zero is dropped: it is settled, and a "0" competes
 * with the lines that are not. If every one of them nets to zero they are all
 * kept, because a header with nothing in it says less than a row of zeroes.
 *
 * Each figure carries its sign, since there is no single word above these the
 * way there is above the converted total — direction stays readable without
 * colour, which is the rule the balance palette is built on. The word the
 * columns used to carry for a screen reader follows each figure instead.
 */
function CurrencyFigures({
  totals,
}: {
  totals: PositionWidgetProps["currencyTotals"];
}) {
  const t = useTranslations("dashboard");
  const tMoney = useTranslations("money");
  const nets = totals.map((total) => ({
    currency: total.currency,
    net: BigInt(total.owedToYou) - BigInt(total.youOwe),
  }));
  const outstanding = nets.filter((entry) => entry.net !== 0n);
  const shown = outstanding.length > 0 ? outstanding : nets;

  // The type steps down as the list grows, so three currencies still sit in
  // about the room one converted total would have taken.
  const size =
    shown.length === 1
      ? "text-[2.875rem]"
      : shown.length === 2
        ? "text-[2.125rem]"
        : "text-[1.625rem]";

  // Spans throughout, because this sits inside the button that opens its
  // footnote, and a button holds phrasing content only.
  return (
    <span className="flex flex-col gap-1">
      {shown.map(({ currency, net }) => (
        <span key={currency} className="block">
          <Amount
            minorUnits={net.toString()}
            currency={currency}
            fractionDigits={0}
            signDisplay="exceptZero"
            className={cn(
              size,
              "leading-none font-semibold tracking-[-0.035em]",
              TONE[toneFor(net)].ink,
            )}
          />
          <span className="sr-only">
            {" "}
            {net > 0n
              ? t("owedToYouLabel")
              : net < 0n
                ? t("youOweLabel")
                : tMoney("settledUpBadge")}
          </span>
        </span>
      ))}
    </span>
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

  /*
   * Three states, and they are not the same absence. Square everywhere is a
   * result and gets the word; a missing rate is a failure and gets the
   * per-currency figures, with the reason a tap behind them. An account
   * holding no balance at all reaches the first through `currencyTotals`
   * being empty rather than through a zero.
   *
   * The totals band only follows a single converted figure. Under the
   * per-currency figures it had nothing to add: each currency nets in one
   * direction, so every row of it was the figure above beside a zero.
   */
  const allSquare =
    (netUnits !== null && netUnits === 0n) ||
    (net === null && currencyTotals.length === 0);
  const ratesUnavailable = net === null && currencyTotals.length > 0;
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
        <div className="flex flex-col gap-1.5">
          <p id={labelId} className="text-xs text-muted-foreground">
            {t("positionEyebrow")}
          </p>
          {allSquare ? (
            <p
              className={cn(
                "text-[1.875rem] font-semibold tracking-[-0.025em]",
                TONE.neutral.ink,
              )}
            >
              {tMoney("settledUpBadge")}
            </p>
          ) : ratesUnavailable ? (
            <FigureDisclosure
              label={t("perCurrencyDisclosureLabel")}
              note={t("ratesUnavailable")}
            >
              <CurrencyFigures totals={currencyTotals} />
            </FigureDisclosure>
          ) : disclosure ? (
            <FigureDisclosure
              label={t("rateDisclosureLabel")}
              note={disclosure}
            >
              {figure}
            </FigureDisclosure>
          ) : (
            figure
          )}
        </div>

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
