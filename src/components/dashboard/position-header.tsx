import { useTranslations } from "next-intl";
import { ArrowDownLeft, ArrowUpRight, Minus } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { cn } from "@/lib/utils";

/**
 * "Where do I stand?", answered once for every group at the top of the home
 * screen.
 *
 * The bar is decorative and hidden from assistive technology: the two totals
 * underneath it are the same information in a form a screen reader can read,
 * and the sign of the headline figure is carried by its icon and its word, not
 * only by its colour.
 */

export interface PositionHeaderProps {
  /** Minor units, signed: positive means the user is owed overall. */
  readonly net: { minorUnits: string; currency: string } | null;
  readonly owedToYou: { minorUnits: string; currency: string } | null;
  readonly youOwe: { minorUnits: string; currency: string } | null;
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
  readonly today: string;
  readonly converted: boolean;
}

/** Flex weights, so the two segments read as a proportion rather than a scale. */
function shareOf(a: bigint, b: bigint): [number, number] {
  const total = a + b;
  if (total === 0n) return [1, 1];
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
  converted,
}: PositionHeaderProps) {
  const t = useTranslations("dashboard");
  const tMoney = useTranslations("money");

  const netUnits = net ? BigInt(net.minorUnits) : null;
  const settledEverywhere = netUnits !== null && netUnits === 0n;
  const positive = netUnits !== null && netUnits > 0n;

  // Only claim a conversion happened when one actually did: a user whose groups
  // all balance in their own currency is not owed an exchange-rate footnote.
  const footnote = !net
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
      className="-mx-4 space-y-3.5 border-b px-4 pt-6 pb-4"
    >
      <h2
        id="your-position"
        className="text-xs font-medium tracking-[0.07em] text-muted-foreground uppercase"
      >
        {t("positionEyebrow")}
      </h2>

      {net && netUnits !== null ? (
        settledEverywhere ? (
          <p className="flex items-center gap-2 text-[1.75rem] font-semibold tracking-[-0.02em] text-neutral-balance">
            <Minus aria-hidden="true" className="size-6" />
            {tMoney("settledUpBadge")}
          </p>
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
        )
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

      {net && !settledEverywhere && owedToYou && youOwe && (
        <>
          <div
            aria-hidden="true"
            className="flex h-[5px] gap-0.5 overflow-hidden rounded-full"
          >
            {(() => {
              const [owedShare, owingShare] = shareOf(
                BigInt(owedToYou.minorUnits),
                BigInt(youOwe.minorUnits),
              );
              return (
                <>
                  {owedShare > 0 && (
                    <span
                      style={{ flexGrow: owedShare }}
                      className="rounded-full bg-positive"
                    />
                  )}
                  {owingShare > 0 && (
                    <span
                      style={{ flexGrow: owingShare }}
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

      {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
    </section>
  );
}
