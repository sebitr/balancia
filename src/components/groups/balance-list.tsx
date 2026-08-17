import Link from "next/link";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Amount, toneFor } from "@/components/money/amount";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

/**
 * Everyone's net position, most negative first. The centred comparison bar is
 * deliberately secondary to the signed, locale-formatted amount: it makes the
 * group's shape glanceable without turning a precise debt into a chart guess.
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
  participantCount,
}: {
  rows: readonly BalanceRowView[];
  groupId: string;
  limit: number;
  participantCount?: number;
}) {
  const t = useTranslations("group");
  const grouped = new Map<
    string,
    {
      participantId: string;
      name: string;
      isSelf: boolean;
      balances: BalanceRowView[];
    }
  >();
  for (const row of rows) {
    const person = grouped.get(row.participantId) ?? {
      participantId: row.participantId,
      name: row.name,
      isSelf: row.isSelf,
      balances: [],
    };
    person.balances.push(row);
    grouped.set(row.participantId, person);
  }
  const shown = [...grouped.values()].slice(0, limit);
  const people = participantCount ?? grouped.size;
  const largestByCurrency = new Map<string, bigint>();
  for (const row of rows) {
    const amount = BigInt(row.minorUnits);
    const magnitude = amount < 0n ? -amount : amount;
    const largest = largestByCurrency.get(row.currency) ?? 0n;
    if (magnitude > largest) largestByCurrency.set(row.currency, magnitude);
  }

  return (
    <section
      aria-labelledby="everyone-balances"
      className="flex flex-col gap-2.5"
    >
      <h2 id="everyone-balances" className="text-sm font-medium">
        {t("everyoneBalances")}
      </h2>

      <ul className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
        {shown.map((person) => (
          <li key={person.participantId} className="border-t first:border-t-0">
            <Link
              href={`/groups/${groupId}/members`}
              transitionTypes={PUSH}
              className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_minmax(68px,0.85fr)_auto] items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-7">
                  <AvatarFallback
                    className={cn(
                      "text-[0.6875rem] font-semibold",
                      person.isSelf
                        ? "bg-primary/15 text-primary"
                        : "bg-accent text-accent-foreground",
                    )}
                  >
                    {person.name.trim().charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-sm font-medium">
                  {person.isSelf ? t("you") : person.name}
                </span>
              </span>

              <span className="flex flex-col gap-2">
                {person.balances.map((balance) => (
                  <ComparisonBar
                    key={balance.currency}
                    minorUnits={balance.minorUnits}
                    largest={largestByCurrency.get(balance.currency) ?? 0n}
                  />
                ))}
              </span>

              <span className="flex shrink-0 flex-col gap-1 text-right text-[0.90625rem] font-semibold tabular-nums">
                {person.balances.map((balance) => (
                  <BalanceValue key={balance.currency} row={balance} />
                ))}
              </span>
            </Link>
          </li>
        ))}

        {people > limit && (
          <li className="border-t">
            <Link
              href={`/groups/${groupId}/balances`}
              transitionTypes={PUSH}
              className="flex min-h-11 items-center justify-center px-3 text-[0.8125rem] font-medium text-primary transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t("viewAllPeople", { count: people })}
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

function BalanceValue({ row }: { row: BalanceRowView }) {
  const t = useTranslations("group");
  return (
    <span
      className={cn(
        toneFor(row.minorUnits) === "positive" && "text-positive",
        toneFor(row.minorUnits) === "negative" && "text-negative",
        toneFor(row.minorUnits) === "neutral" && "text-neutral-balance",
      )}
    >
      <Amount
        minorUnits={row.minorUnits}
        currency={row.currency}
        display="code"
        signDisplay="exceptZero"
      />
      <span className="sr-only">
        {BigInt(row.minorUnits) > 0n
          ? t("balanceReceives")
          : BigInt(row.minorUnits) < 0n
            ? t("balanceOwes")
            : t("balanceSettled")}
      </span>
    </span>
  );
}

function ComparisonBar({
  minorUnits,
  largest,
}: {
  minorUnits: string;
  largest: bigint;
}) {
  const value = BigInt(minorUnits);
  const magnitude = value < 0n ? -value : value;
  const width = largest === 0n ? 0 : Number((magnitude * 50n) / largest);

  return (
    <span
      aria-hidden="true"
      className="relative h-[3px] w-full overflow-hidden rounded-full bg-foreground/[0.09]"
    >
      <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/20" />
      {value !== 0n && (
        <span
          className={cn(
            "absolute inset-y-0",
            value < 0n ? "right-1/2 bg-negative" : "left-1/2 bg-positive",
          )}
          style={{ width: `${width}%` }}
        />
      )}
    </span>
  );
}
