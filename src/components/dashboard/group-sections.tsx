import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { BalanceAmount } from "@/components/money/amount";
import { MemberStack } from "./member-stack";
import { RelativeTime } from "./relative-time";
import { cn } from "@/lib/utils";

/**
 * The triaged body of the home screen.
 *
 * Weight follows what a group asks of the reader. A debt gets a card with the
 * two things you might do about it; being owed gets a row, because there is
 * nothing to do but wait. Direction is carried by the section label, so each
 * amount's own word moves into `sr-only` rather than being dropped — colour is
 * never the only signal.
 */

export interface NeedsYouView {
  readonly id: string;
  readonly name: string;
  readonly memberNames: readonly string[];
  readonly participantCount: number;
  readonly lastActivityAt: string;
  readonly amounts: readonly { minorUnits: string; currency: string }[];
  readonly owedTo:
    | { kind: "single"; name: string }
    | { kind: "several"; count: number }
    | null;
}

export interface OwedView {
  readonly id: string;
  readonly name: string;
  readonly participantCount: number;
  readonly lastActivityAt: string;
  readonly amounts: readonly { minorUnits: string; currency: string }[];
}

export function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 pb-2.5">
        <h3 className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </h3>
        {count !== undefined && (
          <span className="text-[0.6875rem] text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export function NeedsYouCard({
  group,
  now,
  urgent,
}: {
  group: NeedsYouView;
  now: string;
  /** The largest debt, and only ever one. Reinforcement, never the only cue. */
  urgent: boolean;
}) {
  const t = useTranslations("dashboard");

  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 rounded-[17px] bg-card p-4 ring-1 transition-colors",
        urgent
          ? "ring-[color-mix(in_oklch,var(--negative)_28%,transparent)]"
          : "ring-border",
        "hover:bg-[color-mix(in_oklch,var(--muted)_60%,transparent)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1.5">
          {/* The whole card is the link; the buttons below sit above it. */}
          <Link
            href={`/groups/${group.id}`}
            className="truncate text-base font-medium tracking-[-0.01em] before:absolute before:inset-0 before:rounded-[17px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {group.name}
          </Link>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <MemberStack
              names={group.memberNames}
              total={group.participantCount}
            />
            <RelativeTime value={group.lastActivityAt} now={now} />
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {group.amounts.map((amount) => (
            <BalanceAmount
              key={amount.currency}
              minorUnits={amount.minorUnits}
              currency={amount.currency}
              showLabel={false}
              className="text-lg font-semibold [&>svg]:size-4"
            />
          ))}
          {group.owedTo && (
            <span className="text-xs text-muted-foreground">
              {group.owedTo.kind === "single"
                ? t("youOweName", { name: group.owedTo.name })
                : t("splitAcross", { count: group.owedTo.count })}
            </span>
          )}
        </span>
      </div>

      <div className="relative flex items-center gap-2">
        <Button
          asChild
          size="lg"
          variant={urgent ? "default" : "outline"}
          className="h-8 rounded-xl px-[13px] text-[0.8125rem]"
        >
          <Link href={`/groups/${group.id}/balances`}>{t("settleUp")}</Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="h-8 rounded-xl px-[13px] text-[0.8125rem]"
        >
          <Link href={`/groups/${group.id}/expenses/new`}>
            {t("addExpense")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** Rows share one card: being owed is a status, not a task. */
export function OwedCard({
  groups,
  now,
}: {
  groups: readonly OwedView[];
  now: string;
}) {
  const t = useTranslations("dashboard");

  return (
    <ul className="overflow-hidden rounded-[17px] bg-card ring-1 ring-border">
      {groups.map((group) => (
        <li key={group.id} className="border-t first:border-t-0">
          <Link
            href={`/groups/${group.id}`}
            className="flex min-h-11 items-center justify-between gap-3 px-4 py-[13px] transition-colors hover:bg-[color-mix(in_oklch,var(--muted)_60%,transparent)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[0.9375rem] font-medium">
                {group.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("peopleCount", { count: group.participantCount })}
                {" · "}
                <RelativeTime value={group.lastActivityAt} now={now} />
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {group.amounts.map((amount) => (
                <BalanceAmount
                  key={amount.currency}
                  minorUnits={amount.minorUnits}
                  currency={amount.currency}
                  showLabel={false}
                  className="text-[0.9375rem] [&>svg]:size-3.5"
                />
              ))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The all-settled screen's only section: what moved recently, no amounts. */
export function RecentlyActiveCard({
  groups,
  now,
}: {
  groups: readonly OwedView[];
  now: string;
}) {
  return (
    <ul className="overflow-hidden rounded-[17px] bg-card ring-1 ring-border">
      {groups.map((group) => (
        <li key={group.id} className="border-t first:border-t-0">
          <Link
            href={`/groups/${group.id}`}
            className="flex min-h-11 items-center justify-between gap-3 px-4 py-[13px] transition-colors hover:bg-[color-mix(in_oklch,var(--muted)_60%,transparent)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
          >
            <span className="truncate text-[0.9375rem] font-medium">
              {group.name}
            </span>
            <RelativeTime
              value={group.lastActivityAt}
              now={now}
              className="shrink-0 text-xs text-muted-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
