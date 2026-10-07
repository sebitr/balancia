import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BalanceAmount } from "@/components/money/amount";
import { TONE, toneFor } from "@/components/money/balance-tone";
import { GroupIconTile } from "@/components/groups/group-icon";
import { cn } from "@/lib/utils";
import type { GroupIcon, GroupIconColor } from "@/modules/groups/icons";
import { minorUnitsPerMajor } from "@/modules/currencies/iso-4217";
import { MemberStack } from "./member-stack";
import { RelativeTime } from "./relative-time";
import { PUSH } from "@/components/motion/transitions";

/**
 * The ranked body of the home screen.
 *
 * One row anatomy serves both directional sections: urgency comes from the
 * order and the section label above, never from a bigger number or a tinted
 * ring. Nothing here is carded — the position widget is the screen's only
 * raised surface, and this list is the page itself.
 *
 * A row's only job is to open its group. Every action lives inside the group,
 * so there are no buttons out here competing with the one that matters.
 *
 * Direction is carried by the section label, so each amount's own word moves
 * into `sr-only` rather than being dropped — colour is never the only signal.
 *
 * Amounts are rounded to whole units, as a converted total is in the widget
 * above: this list is scanned, not reconciled, and the group's own screen has
 * the centimes (#100). But the widget keeps them whenever it shows a group's
 * own currency, and "− CHF 961" under a heading of "CHF 960.84" read as two
 * different debts. So a figure the rounding has moved says so — "≈ CHF 961" —
 * and one under a single unit is shown exactly, because rounded it would be a
 * debt of nothing.
 *
 * ## From `lg` up
 *
 * The same row, as the desktop board "01 · Home" draws it. The meta line
 * counts the people as well as showing them — "6 people · 2 hours ago" — and
 * each figure is said in words beside it, one line per currency: "€248 you
 * are owed" over "≈ CHF 62 you owe", in the tone's ink. With the word on the
 * screen the figure drops its sign, as money.html asks of any figure that has
 * one beside it. The row stays one link, still flat on the page, and its
 * figures still whole units: the width is room for words, not for centimes.
 *
 * The board's hover preview — a group's last three expenses, with Settle up
 * and Add expense — is not drawn. This screen loads balances, not entries,
 * and a preview would cost a read per group to show what one click away
 * already shows.
 */

/**
 * How a row draws one figure: in whole units, marked when that moved it.
 *
 * `approximate` is false for a figure already whole, which "≈" would only cast
 * doubt on, and for a currency with no minor unit at all.
 */
export function rowFigure(
  minorUnits: string,
  currency: string,
): { fractionDigits: number | undefined; approximate: boolean } {
  const units = BigInt(minorUnits);
  const magnitude = units < 0n ? -units : units;
  const unit = minorUnitsPerMajor(currency);
  if (magnitude < unit)
    return { fractionDigits: undefined, approximate: false };
  return { fractionDigits: 0, approximate: magnitude % unit !== 0n };
}

export interface GroupRowView {
  readonly id: string;
  readonly name: string;
  readonly icon: GroupIcon | null;
  readonly iconColor: GroupIconColor | null;
  readonly memberNames: readonly string[];
  readonly participantCount: number;
  readonly lastActivityAt: string;
  readonly amounts: readonly { minorUnits: string; currency: string }[];
}

export function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="pb-2.5 text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

export function GroupList({
  groups,
  now,
}: {
  groups: readonly GroupRowView[];
  now: string;
}) {
  const t = useTranslations("dashboard");

  return (
    <ul>
      {groups.map((group) => (
        // Every row has a top border, including the first, so the section
        // label always sits above a hairline.
        <li key={group.id} className="border-t">
          <Link
            href={`/groups/${group.id}`}
            transitionTypes={PUSH}
            // The padding belongs to the link rather than the item, so the
            // hover fill covers the full height of the row.
            className="flex items-center gap-3 py-3.5 transition-colors hover:bg-wash-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0 lg:gap-3.5"
          >
            {/* The tile tints itself only when the group has chosen an icon,
                so `bg-accent` here is the fallback behind the initial. */}
            <GroupIconTile
              icon={group.icon}
              color={group.iconColor}
              name={group.name}
              className="size-10 rounded-xl bg-accent text-accent-foreground lg:size-9 lg:rounded-[11px]"
              iconClassName="size-[19px] lg:size-[17px]"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="truncate text-base font-medium tracking-[-0.01em]">
                {group.name}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <MemberStack
                  names={group.memberNames}
                  total={group.participantCount}
                />
                <span className="lg:min-w-0 lg:truncate">
                  {/* The stack names three people at most; the count is
                      the rest of the answer, where there is room for it. */}
                  <span className="hidden lg:inline">
                    {t("peopleCount", { count: group.participantCount })}
                    {" · "}
                  </span>
                  <RelativeTime value={group.lastActivityAt} now={now} />
                </span>
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {group.amounts.map((amount) => (
                <span
                  key={amount.currency}
                  className="flex items-baseline gap-1.5"
                >
                  {/* From `lg` the figure loses its sign — the child
                      `BalanceAmount` hides from assistive technology, which
                      is the sign and only the sign — and the word beside it
                      takes over saying which way it runs. */}
                  <BalanceAmount
                    minorUnits={amount.minorUnits}
                    currency={amount.currency}
                    {...rowFigure(amount.minorUnits, amount.currency)}
                    showLabel={false}
                    className="text-base lg:text-sm lg:font-semibold lg:[&>[aria-hidden=true]]:hidden [&>svg]:size-[15px]"
                  />
                  <RowWord minorUnits={amount.minorUnits} />
                </span>
              ))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The figure's direction in words, from `lg` — the reader's own words, "you
 * owe" and "you are owed", which the position widget already uses.
 *
 * Hidden from assistive technology: `BalanceAmount` already says the
 * direction to a screen reader at every width, and this is the same fact
 * drawn for the eye where there is room to draw it.
 */
function RowWord({ minorUnits }: { minorUnits: string }) {
  const t = useTranslations("dashboard");
  const tone = toneFor(minorUnits);
  if (tone === "neutral") return null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "hidden text-xs whitespace-nowrap lg:inline",
        TONE[tone].ink,
      )}
    >
      {tone === "positive" ? t("wordOwedToYou") : t("wordYouOwe")}
    </span>
  );
}
