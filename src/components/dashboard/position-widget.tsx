"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Amount } from "@/components/money/amount";
import { AddExpenseSheet, type PickableGroup } from "./add-expense-sheet";
import { cn } from "@/lib/utils";

/**
 * "Where do I stand?", answered once for every group, at the top of the screen.
 *
 * This is the screen's only raised surface — everything below it sits flat on
 * the page — so it is a contained module with a hairline ring and a lit top
 * edge rather than a drop shadow. There is no page title: the number is the
 * title.
 *
 * The proportional rule is decorative and hidden from assistive technology;
 * the two totals underneath say the same thing in a form a screen reader can
 * read, and the sign of the headline figure is carried by its colour and the
 * signs below it rather than by colour alone.
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

  const netUnits = net ? BigInt(net.minorUnits) : null;
  const positive = netUnits !== null && netUnits > 0n;

  /*
   * Three states, and they are not the same absence. Square everywhere is a
   * result and gets the word; a missing rate is a failure and gets the
   * per-currency figures with a line saying so. An account holding no balance
   * at all reaches the first through `currencyTotals` being empty rather than
   * through a zero.
   */
  const allSquare =
    (netUnits !== null && netUnits === 0n) ||
    (net === null && currencyTotals.length === 0);
  const ratesUnavailable = net === null && currencyTotals.length > 0;
  const showTotals = !allSquare && (net !== null || ratesUnavailable);

  /*
   * The rate the figure was converted at, one tap away. The widget shows a
   * converted total without saying so — a standing footnote under every
   * balance is noise on the days nothing has moved — but the disclosure is not
   * allowed to disappear, so the figure itself opens it.
   */
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
          positive ? "text-positive" : "text-negative",
        )}
      />
    ) : null;

  return (
    <section
      aria-label={t("positionEyebrow")}
      className="overflow-hidden rounded-[20px] bg-card shadow-[inset_0_1px_0_0_oklch(1_0_0/7%)] ring-1 ring-foreground/10"
    >
      <div className="flex flex-col gap-[18px] px-[18px] pt-5 pb-4">
        <div className="flex flex-col gap-2.5">
          {allSquare ? (
            <p className="text-[1.875rem] font-semibold tracking-[-0.025em] text-neutral-balance">
              {tMoney("settledUpBadge")}
            </p>
          ) : ratesUnavailable ? (
            <p className="text-[0.9375rem] text-muted-foreground">
              {t("ratesUnavailable")}
            </p>
          ) : disclosure ? (
            <Popover>
              <PopoverTrigger className="self-start rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {figure}
                <span className="sr-only">{t("rateDisclosureLabel")}</span>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto max-w-[17rem]">
                <p className="text-muted-foreground">{disclosure}</p>
              </PopoverContent>
            </Popover>
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
                          className="rounded-full bg-positive"
                        />
                      )}
                      {owing > 0 && (
                        <span
                          style={{ flexGrow: owing }}
                          className="rounded-full bg-negative"
                        />
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            <div className="-mt-2 grid grid-cols-2">
              <TotalsColumn label={t("owedToYouLabel")}>
                {net && owedToYou ? (
                  <TintedTotal
                    minorUnits={owedToYou.minorUnits}
                    currency={owedToYou.currency}
                    tone="positive"
                  />
                ) : (
                  currencyTotals.map((total) => (
                    <TintedTotal
                      key={total.currency}
                      minorUnits={total.owedToYou}
                      currency={total.currency}
                      tone="positive"
                    />
                  ))
                )}
              </TotalsColumn>
              <TotalsColumn label={t("youOweLabel")} divided>
                {net && youOwe ? (
                  <TintedTotal
                    minorUnits={youOwe.minorUnits}
                    currency={youOwe.currency}
                    tone="negative"
                  />
                ) : (
                  currencyTotals.map((total) => (
                    <TintedTotal
                      key={total.currency}
                      minorUnits={total.youOwe}
                      currency={total.currency}
                      tone="negative"
                    />
                  ))
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
      {/* Wraps rather than overflowing: "Ajouter une dépense" and "Nouveau
          groupe" do not fit side by side on a narrow phone. */}
      <div className="flex flex-wrap items-center gap-2 border-t bg-[color-mix(in_oklch,var(--muted)_45%,transparent)] px-[18px] py-[13px]">
        <Button
          type="button"
          onClick={() => setPicking(true)}
          className="h-[34px] rounded-xl px-[13px] py-[5px] text-sm"
        >
          <Plus aria-hidden="true" className="size-[15px]" />
          {t("addExpense")}
        </Button>
        {/* Creating a group is a key action, so it reads as the second of two
            buttons — the border is deliberately stronger than `--input`, which
            is tuned for form fields at rest. */}
        <Button
          asChild
          variant="outline"
          className="h-[34px] rounded-xl border-foreground/25 bg-foreground/[0.06] px-[13px] py-[5px] text-sm dark:border-foreground/25 dark:bg-foreground/[0.06]"
        >
          {/* Opens the create sheet on this page rather than pushing a screen. */}
          <Link href="?new" replace scroll={false}>
            <Plus aria-hidden="true" className="size-[15px]" />
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
  const sign = tone === "positive" ? "+" : "−";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[0.9375rem] font-medium",
        tone === "positive" ? "text-positive" : "text-negative",
      )}
    >
      <span
        aria-hidden="true"
        className="w-3.5 shrink-0 text-center leading-none font-semibold"
      >
        {sign}
      </span>
      <Amount minorUnits={minorUnits} currency={currency} fractionDigits={0} />
    </span>
  );
}
