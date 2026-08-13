"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Archive, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { BalanceAmount } from "@/components/money/amount";
import { cn } from "@/lib/utils";

/**
 * The ranked group list: what you owe, what you are owed, what is settled, and
 * what you have archived.
 *
 * A client component for one reason — the search field filters the list the
 * server already sent, with no round trip. Everything it renders was resolved
 * on the server and arrives as plain serialisable values.
 *
 * Direction lives in the section label, so each row's "owes" / "gets back"
 * moves to `sr-only` rather than disappearing: colour is never alone in
 * carrying meaning here either.
 */

export interface GroupRowView {
  readonly id: string;
  readonly name: string;
  readonly memberNames: readonly string[];
  readonly participantCount: number;
  readonly lastActivityAt: string;
  /**
   * Usually one figure. More than one only where a group balances in several
   * currencies and no rate was available to fold them together.
   */
  readonly amounts: readonly { minorUnits: string; currency: string }[];
}

export interface GroupListProps {
  readonly youOwe: readonly GroupRowView[];
  readonly youAreOwed: readonly GroupRowView[];
  readonly settled: readonly GroupRowView[];
  readonly archived: readonly GroupRowView[];
  /** Pinned server-side so relative times match across the hydration boundary. */
  readonly now: string;
}

/** Above this many groups, finding one by eye stops being realistic. */
const SEARCH_THRESHOLD = 8;

function matches(group: GroupRowView, query: string): boolean {
  return group.name.toLowerCase().includes(query);
}

function RelativeTime({ value, now }: { value: string; now: string }) {
  const format = useFormatter();
  const date = new Date(value);
  return (
    <time dateTime={value} title={format.dateTime(date, { dateStyle: "long" })}>
      {format.relativeTime(date, new Date(now))}
    </time>
  );
}

/**
 * Overlapping initials. A single letter each: at 20px a two-letter initial is
 * clipped by the next avatar in the overlap.
 */
function MemberStack({
  names,
  total,
}: {
  names: readonly string[];
  total: number;
}) {
  const t = useTranslations("dashboard");
  const overflow = total - names.length;
  const shown = overflow > 0 ? names.slice(0, names.length - 1) : names;
  const counter = total - shown.length;

  const label =
    counter > 0
      ? t("membersWithOthers", { names: shown.join(", "), count: counter })
      : t("members", { names: shown.join(", ") });

  return (
    <span
      role="img"
      aria-label={label}
      className="flex shrink-0 -space-x-1.5 *:ring-2 *:ring-background"
    >
      {shown.map((name, index) => (
        <Avatar key={`${name}-${index}`} className="size-5">
          <AvatarFallback className="bg-accent text-[9px] font-semibold text-accent-foreground">
            {name.trim().charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
      {counter > 0 && (
        <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-accent-foreground">
          +{counter}
        </span>
      )}
    </span>
  );
}

function ActiveRow({ group, now }: { group: GroupRowView; now: string }) {
  return (
    <li className="border-t">
      <Link
        href={`/groups/${group.id}`}
        className="flex min-h-11 items-center gap-3 rounded-md py-2.5 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-[0.9375rem] font-medium tracking-[-0.01em]">
            {group.name}
          </span>
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
              className="text-[0.9375rem]"
            />
          ))}
        </span>
      </Link>
    </li>
  );
}

function SettledRow({ group, now }: { group: GroupRowView; now: string }) {
  const t = useTranslations("dashboard");
  return (
    <li className="border-t">
      <Link
        href={`/groups/${group.id}`}
        className="flex min-h-11 items-center justify-between gap-3 rounded-md py-2 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
      >
        <span className="truncate text-sm">{group.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("peopleCount", { count: group.participantCount })}
          {" · "}
          <RelativeTime value={group.lastActivityAt} now={now} />
        </span>
      </Link>
    </li>
  );
}

function Section({
  label,
  labelClassName,
  count,
  children,
}: {
  label: string;
  labelClassName: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 pb-2.5">
        <h3
          className={cn(
            "text-[0.6875rem] font-semibold tracking-[0.08em] uppercase",
            labelClassName,
          )}
        >
          {label}
        </h3>
        <span className="text-[0.6875rem] text-muted-foreground">{count}</span>
      </div>
      <ul>{children}</ul>
    </section>
  );
}

export function GroupList({
  youOwe,
  youAreOwed,
  settled,
  archived,
  now,
}: GroupListProps) {
  const t = useTranslations("dashboard");
  const [query, setQuery] = useState("");

  const total = youOwe.length + youAreOwed.length + settled.length;
  const needle = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (needle === "") return { youOwe, youAreOwed, settled, archived };
    const keep = (groups: readonly GroupRowView[]) =>
      groups.filter((group) => matches(group, needle));
    return {
      youOwe: keep(youOwe),
      youAreOwed: keep(youAreOwed),
      settled: keep(settled),
      archived: keep(archived),
    };
  }, [needle, youOwe, youAreOwed, settled, archived]);

  const nothingMatched =
    needle !== "" &&
    filtered.youOwe.length === 0 &&
    filtered.youAreOwed.length === 0 &&
    filtered.settled.length === 0 &&
    filtered.archived.length === 0;

  return (
    <div className="space-y-4">
      {total > SEARCH_THRESHOLD && (
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-[15px] -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("searchLabel")}
            placeholder={t("searchPlaceholder", { count: total })}
            className="h-[34px] rounded-xl pl-9 text-[0.8125rem]"
          />
        </div>
      )}

      {nothingMatched ? (
        <p className="py-2 text-sm text-muted-foreground">
          {t("noMatch", { query: query.trim() })}
        </p>
      ) : (
        <div className="space-y-5.5">
          {filtered.youOwe.length > 0 && (
            <Section
              label={t("sectionYouOwe")}
              labelClassName="text-negative"
              count={filtered.youOwe.length}
            >
              {filtered.youOwe.map((group) => (
                <ActiveRow key={group.id} group={group} now={now} />
              ))}
            </Section>
          )}

          {filtered.youAreOwed.length > 0 && (
            <Section
              label={t("sectionYouAreOwed")}
              labelClassName="text-positive"
              count={filtered.youAreOwed.length}
            >
              {filtered.youAreOwed.map((group) => (
                <ActiveRow key={group.id} group={group} now={now} />
              ))}
            </Section>
          )}

          {filtered.settled.length > 0 && (
            <Section
              label={t("sectionSettled")}
              labelClassName="text-neutral-balance"
              count={filtered.settled.length}
            >
              {filtered.settled.map((group) => (
                <SettledRow key={group.id} group={group} now={now} />
              ))}
            </Section>
          )}

          {filtered.archived.length > 0 && (
            <section>
              <h3 className="flex items-center gap-2 pb-2.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                <Archive aria-hidden="true" className="size-3.5" />
                {t("sectionArchived", { count: filtered.archived.length })}
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {filtered.archived.map((group) => (
                  <li key={group.id}>
                    <Link
                      href={`/groups/${group.id}`}
                      className="inline-flex h-[26px] items-center rounded-full border px-2.5 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {group.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
