import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BalanceAmount } from "@/components/money/amount";

/**
 * Who owes whom, in reading order: the reader, then the people owed money,
 * then the people who owe it.
 *
 * Only open positions appear. A settled member adds nothing to a list whose
 * subject is outstanding debt, and on a large group they would crowd out the
 * rows worth reading — which is also why the list stops at five and hands the
 * rest to the balances screen.
 */

export interface BalanceRowView {
  readonly participantId: string;
  readonly name: string;
  readonly currency: string;
  /** Signed minor units: positive means this person is owed. */
  readonly minorUnits: string;
  readonly isSelf: boolean;
  /** ISO instant of the last nudge sent to them, if any. */
  readonly remindedAt: string | null;
}

export function BalanceList({
  rows,
  groupId,
  limit,
  now,
}: {
  rows: readonly BalanceRowView[];
  groupId: string;
  limit: number;
  /** Pinned by the server so "just now" cannot disagree after hydration. */
  now: string;
}) {
  const t = useTranslations("group");
  const format = useFormatter();
  const shown = rows.slice(0, limit);

  return (
    <section aria-labelledby="who-owes-whom" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="who-owes-whom"
          className="text-sm font-medium text-muted-foreground"
        >
          {t("whoOwesWhom")}
        </h2>
        <Link
          href={`/groups/${groupId}/balances`}
          className="-my-2 shrink-0 rounded-[10px] px-2 py-2 text-[0.8125rem] font-medium text-primary transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t("allBalances")}
        </Link>
      </div>

      <ul className="overflow-hidden rounded-[14px] ring-1 ring-border">
        {shown.map((row) => (
          <li key={`${row.participantId}-${row.currency}`}>
            <Link
              href={`/groups/${groupId}/members`}
              className="flex min-h-11 items-center justify-between gap-3 border-t px-3 py-[11px] transition-colors first:border-t-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-[26px]">
                  <AvatarFallback className="bg-accent text-[0.6875rem] font-semibold text-accent-foreground">
                    {row.name.trim().charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {row.isSelf ? t("you") : row.name}
                  </span>
                  {/* Deliberately not a read receipt: it records that the
                      asking happened, which is all the system can know. */}
                  {row.remindedAt && (
                    <span className="truncate text-xs text-muted-foreground">
                      {t("remindedAt", {
                        when: format.relativeTime(
                          new Date(row.remindedAt),
                          new Date(now),
                        ),
                      })}
                    </span>
                  )}
                </span>
              </span>

              <BalanceAmount
                minorUnits={row.minorUnits}
                currency={row.currency}
                className="shrink-0 text-sm [&>svg]:size-[15px]"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
