import { useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { cn } from "@/lib/utils";

/**
 * The group's shape in three figures: what it spent, what the reader put in,
 * and what was actually theirs to carry.
 *
 * The third is the one that explains the other two — "you paid €930.50, your
 * share was €682.50" is the whole of why the position above says what it says.
 *
 * A group balancing in several currencies stacks them inside each cell. They
 * are never summed: an exchange rate would have to be invented to do it.
 */

export interface StatView {
  readonly currency: string;
  readonly groupSpent: string;
  readonly youPaid: string;
  readonly yourShare: string;
}

export function StatStrip({ stats }: { stats: readonly StatView[] }) {
  const t = useTranslations("group");

  const cells = [
    { key: "statGroupSpent", pick: (stat: StatView) => stat.groupSpent },
    { key: "statYouPaid", pick: (stat: StatView) => stat.youPaid },
    { key: "statYourShare", pick: (stat: StatView) => stat.yourShare },
  ] as const;

  return (
    <dl className="grid grid-cols-3 rounded-[14px] ring-1 ring-border">
      {cells.map((cell, index) => (
        <div
          key={cell.key}
          className={cn(
            // The cells stretch to the tallest of them, and the figures line
            // up along the bottom rather than trailing whichever label
            // happened to wrap — which they do, in longer languages.
            "flex flex-col justify-between p-3",
            index < cells.length - 1 && "border-r",
          )}
        >
          <dt className="text-[0.6875rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
            {t(cell.key)}
          </dt>
          <dd className="mt-1 flex flex-col gap-0.5">
            {stats.map((stat) => (
              <Amount
                key={stat.currency}
                minorUnits={cell.pick(stat)}
                currency={stat.currency}
                className="text-[0.9375rem] font-semibold"
              />
            ))}
            {stats.length === 0 && (
              <span className="text-[0.9375rem] font-semibold text-muted-foreground">
                —
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
