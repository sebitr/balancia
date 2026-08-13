import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowDownLeft, ArrowUpRight, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/money/amount";
import { cn } from "@/lib/utils";

/**
 * "Where do I stand?", answered once for every group, at the top of the screen.
 *
 * There is no page title here — the number is the title. The bar is decorative
 * and hidden from assistive technology: the two totals underneath it say the
 * same thing in a form a screen reader can read, and the sign of the headline
 * figure is carried by its colour, its icon and its trailing phrase rather than
 * by colour alone.
 */

interface Figure {
  readonly minorUnits: string;
  readonly currency: string;
}

export interface PositionHeaderProps {
  /** Minor units, signed: positive means the user is owed overall. */
  readonly net: Figure | null;
  readonly owedToYou: Figure | null;
  readonly youOwe: Figure | null;
  readonly owedGroupCount: number;
  readonly owingGroupCount: number;
  /** Per-currency totals, shown when there is no rate to convert with. */
  readonly currencyTotals: readonly {
    currency: string;
    owedToYou: string;
    youOwe: string;
  }[];
  readonly displayCurrency: string | null;
  readonly ratesAsOf: string | null;
  /** `YYYY-MM-DD`, compared against `ratesAsOf` to phrase the footnote. */
  readonly today: string;
  /** The same moment as an instant, for relative time. Pinned by the server. */
  readonly now: string;
  readonly converted: boolean;
  /** Where `Add expense` goes when no group has been chosen yet. */
  readonly addExpenseHref: string;
  /** Where the header's `Settle up` goes; absent when there is nothing owed. */
  readonly settleUpHref: string | null;
  readonly groupCount: number;
  readonly lastCleared: { at: string; groupName: string } | null;
}

/** Flex weights, so the two segments read as a proportion rather than a scale. */
function shareOf(a: bigint, b: bigint): [number, number] {
  if (a + b === 0n) return [1, 1];
  return [Number(a), Number(b)];
}

export function PositionHeader({
  net,
  owedToYou,
  youOwe,
  owedGroupCount,
  owingGroupCount,
  currencyTotals,
  displayCurrency,
  ratesAsOf,
  today,
  now,
  converted,
  addExpenseHref,
  settleUpHref,
  groupCount,
  lastCleared,
}: PositionHeaderProps) {
  const t = useTranslations("dashboard");
  const tMoney = useTranslations("money");
  const format = useFormatter();

  const netUnits = net ? BigInt(net.minorUnits) : null;
  const positive = netUnits !== null && netUnits > 0n;

  /*
   * Three states, and they are not the same absence. Square everywhere is a
   * result and gets the word; a missing rate is a failure and gets the
   * per-currency figures with a footnote saying so. An account holding no
   * balance at all reaches the first through `currencyTotals` being empty
   * rather than through a zero.
   */
  const allSquare =
    (netUnits !== null && netUnits === 0n) ||
    (net === null && currencyTotals.length === 0);
  const ratesUnavailable = net === null && currencyTotals.length > 0;

  const footnote = allSquare
    ? lastCleared
      ? t("nothingOutstandingSince", {
          groups: groupCount,
          when: format.relativeTime(new Date(lastCleared.at), new Date(now)),
          group: lastCleared.groupName,
        })
      : t("nothingOutstanding", { groups: groupCount })
    : ratesUnavailable
      ? t("ratesUnavailable")
      : converted && displayCurrency
        ? ratesAsOf === today
          ? t("convertedToday", { currency: displayCurrency })
          : t("convertedOn", {
              currency: displayCurrency,
              date: ratesAsOf ?? today,
            })
        : null;

  return (
    <section
      aria-labelledby="your-position"
      className="-mx-4 flex flex-col gap-3.5 border-b px-4 pt-6 pb-[18px]"
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          id="your-position"
          className="pt-1 text-xs font-medium tracking-[0.07em] text-muted-foreground uppercase"
        >
          {t("positionEyebrow")}
        </h2>
        <Button asChild size="lg" className="h-8 shrink-0 rounded-xl px-[11px]">
          <Link href={addExpenseHref}>
            <Plus aria-hidden="true" className="size-[15px]" />
            {t("addExpense")}
          </Link>
        </Button>
      </div>

      {allSquare ? (
        <p className="flex items-center gap-2 text-[1.75rem] font-semibold tracking-[-0.02em] text-neutral-balance">
          <Minus aria-hidden="true" className="size-6 shrink-0" />
          {tMoney("settledUpBadge")}
        </p>
      ) : net && netUnits !== null ? (
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <Amount
            minorUnits={(netUnits < 0n ? -netUnits : netUnits).toString()}
            currency={net.currency}
            className={cn(
              "text-[2.75rem] leading-none font-semibold tracking-[-0.03em]",
              positive ? "text-positive" : "text-negative",
            )}
          />
          <span className="text-[0.9375rem] text-muted-foreground">
            {positive ? t("owedToYou") : t("youOweOverall")}
          </span>
        </p>
      ) : (
        /* No rate to convert with: several honest figures, never one guess. */
        <ul className="space-y-1.5">
          {currencyTotals.map((total) => (
            <li
              key={total.currency}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[0.9375rem]"
            >
              <span className="font-medium text-muted-foreground">
                {total.currency}
              </span>
              <span className="inline-flex items-center gap-1.5 text-positive">
                <ArrowDownLeft aria-hidden="true" className="size-4" />
                <Amount
                  minorUnits={total.owedToYou}
                  currency={total.currency}
                  className="font-medium"
                />
                <span className="text-muted-foreground">
                  {tMoney("getsBack")}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-negative">
                <ArrowUpRight aria-hidden="true" className="size-4" />
                <Amount
                  minorUnits={total.youOwe}
                  currency={total.currency}
                  className="font-medium"
                />
                <span className="text-muted-foreground">{tMoney("owes")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {net && !allSquare && owedToYou && youOwe && (
        <>
          <div
            aria-hidden="true"
            className="flex h-[5px] gap-0.5 overflow-hidden rounded-full"
          >
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

          <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[0.8125rem]">
            <span className="inline-flex items-center gap-1.5">
              <ArrowDownLeft
                aria-hidden="true"
                className="size-3.5 text-positive"
              />
              <Amount
                minorUnits={owedToYou.minorUnits}
                currency={owedToYou.currency}
                className="font-medium text-positive"
              />
              <span className="text-muted-foreground">
                {t("inGroups", { count: owedGroupCount })}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ArrowUpRight
                aria-hidden="true"
                className="size-3.5 text-negative"
              />
              <Amount
                minorUnits={youOwe.minorUnits}
                currency={youOwe.currency}
                className="font-medium text-negative"
              />
              <span className="text-muted-foreground">
                {t("inCount", { count: owingGroupCount })}
              </span>
            </span>
          </p>
        </>
      )}

      <div className="flex items-center justify-between gap-4 pt-0.5">
        <p className="text-xs text-muted-foreground">{footnote}</p>
        {settleUpHref && !allSquare && (
          <Link
            href={settleUpHref}
            className="shrink-0 rounded-md py-2 text-[0.8125rem] font-medium text-primary transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("settleUp")}
          </Link>
        )}
      </div>
    </section>
  );
}
