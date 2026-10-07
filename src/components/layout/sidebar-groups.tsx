"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronRight, Ellipsis } from "lucide-react";
import { GroupIconTile } from "@/components/groups/group-icon";
import { TONE, toneFor } from "@/components/money/balance-tone";
import { PUSH, SWITCH_FORWARD } from "@/components/motion/transitions";
import { Skeleton } from "@/components/ui/skeleton";
import { useNumberLocale } from "@/i18n/format-context";
import { formatMoney, money } from "@/modules/currencies/money";
import type { NavigationGroup } from "@/modules/balances/navigation";
import { cn } from "@/lib/utils";
import { SidebarTip, useSidebar } from "./sidebar-context";

/**
 * Every group and where the reader stands in it: the sidebar's list on a
 * desktop, and the rows of the phone's switcher panel.
 *
 * One row for both, so a group says the same thing in either place. Where the
 * reader stands is said in words, one line per currency, each in its own
 * tone's ink — "you are owed €248.00" over "you owe CHF 62.20". The row used
 * to join every figure under one verb, and the verb came from the group's
 * overall direction, so a group holding a credit in euros and a debt in francs
 * read "you owe €248.00 · CHF 62.20": a debt that was not one, and a credit
 * reported as owed.
 */

/**
 * Sections a switch can land on, so it keeps the screen you were looking at.
 *
 * `import` is deliberately absent: it is the one section that 404s outright
 * where the actor cannot import, so carrying it across would drop an owner
 * into a dead end in the group they are merely a member of. It falls back to
 * that group's overview instead.
 */
const GROUP_SECTIONS = [
  "expenses",
  "members",
  "settings",
  "balances",
  "activity",
  "recurring",
] as const;

/**
 * The same screen, in another group.
 *
 * Only the section survives the move: a path any deeper names a row — an
 * expense, a participant — that belongs to the group being left and has no
 * counterpart in the one being entered. Anything unrecognised lands on the
 * overview, which every group has.
 */
export function equivalentPath(
  pathname: string,
  fromGroupId: string | null,
  toGroupId: string,
): string {
  const destination = `/groups/${toGroupId}`;
  if (fromGroupId === null) return destination;
  const base = `/groups/${fromGroupId}`;
  if (!pathname.startsWith(base)) return destination;

  const [section] = pathname.slice(base.length).split("/").filter(Boolean);
  return section && (GROUP_SECTIONS as readonly string[]).includes(section)
    ? `${destination}/${section}`
    : destination;
}

export interface PositionLine {
  readonly key: string;
  readonly text: string;
  /** The tone's ink — text, never the fill, never `--primary`. */
  readonly ink: string;
}

/**
 * Where the reader stands in a group, as the lines a row prints — here, and in
 * the command palette's Groups, which say it in the same words.
 */
export function usePositionLines(group: NavigationGroup): PositionLine[] {
  const t = useTranslations("nav");
  const locale = useNumberLocale();

  if (group.amounts.length === 0) {
    return [
      {
        key: "settled",
        text: t("switcherSettled"),
        ink: TONE.neutral.ink,
      },
    ];
  }

  return group.amounts.map((amount) => {
    const signed = BigInt(amount.minorUnits);
    const tone = toneFor(signed);
    // Unsigned: the words carry the direction, and a minus sign beside "you
    // owe" would say it twice.
    const figure = formatMoney(
      money(signed < 0n ? -signed : signed, amount.currency),
      { locale },
    );
    return {
      key: amount.currency,
      text: t(tone === "positive" ? "switcherYouAreOwed" : "switcherYouOwe", {
        amount: figure,
      }),
      ink: TONE[tone].ink,
    };
  });
}

export function GroupRow({
  group,
  isCurrent,
  href,
  variant,
  transitionTypes,
}: {
  group: NavigationGroup;
  isCurrent: boolean;
  href: string;
  /**
   * `switcher` is a row of the phone's panel, ruled off from the next;
   * `sidebar` a rounded row of the desktop column, which folds to its tile.
   */
  variant: "switcher" | "sidebar";
  transitionTypes: string[];
}) {
  const t = useTranslations("nav");
  const lines = usePositionLines(group);
  const { collapsed } = useSidebar();
  const folded = variant === "sidebar" && collapsed;

  /*
   * The row's lines are only told apart on screen by being stacked, so the
   * link's name says them with the pauses written in — "Lisbon, March, you
   * are owed €248.00, you owe CHF 62.20" — rather than leaving each reader
   * to run them together. Every visible word is in it, in order.
   */
  const spoken = [
    group.name,
    ...(variant === "switcher" && isCurrent
      ? [t("youAreHere")]
      : lines.map((line) => line.text)),
  ].join(", ");

  const tile = (
    <GroupIconTile
      icon={group.icon}
      color={group.iconColor}
      name={group.name}
      muted={isCurrent}
      className={cn(
        "rounded-[9px] text-2xs font-semibold",
        folded ? "size-8 rounded-[10px]" : "size-7",
        isCurrent
          ? "bg-primary text-primary-foreground"
          : "bg-accent text-accent-foreground",
      )}
      iconClassName="size-[15px]"
    />
  );

  if (variant === "switcher") {
    return (
      <Link
        href={href}
        transitionTypes={transitionTypes}
        aria-current={isCurrent ? "true" : undefined}
        aria-label={spoken}
        className={cn(
          "flex items-center gap-2.5 border-t px-3.5 py-2.5 transition-colors hover:bg-wash-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
          isCurrent && "bg-wash-2",
        )}
      >
        {tile}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{group.name}</span>
          {/* The panel is for leaving: the group already open is marked
              rather than priced, since its own screen is right behind. */}
          {isCurrent ? (
            <span className="truncate text-xs text-muted-foreground">
              {t("youAreHere")}
            </span>
          ) : (
            lines.map((line) => (
              <span
                key={line.key}
                className={cn("truncate text-xs tabular-nums", line.ink)}
              >
                {line.text}
              </span>
            ))
          )}
        </span>
        {isCurrent && (
          <Check
            aria-hidden="true"
            strokeWidth={2.4}
            className="size-4 shrink-0 text-primary-ink"
          />
        )}
      </Link>
    );
  }

  const words = (
    <>
      <span className="truncate text-sm font-medium">{group.name}</span>
      {lines.map((line) => (
        <span
          key={line.key}
          className={cn("truncate text-xs tabular-nums", line.ink)}
        >
          {line.text}
        </span>
      ))}
    </>
  );

  return (
    <SidebarTip card content={words}>
      <Link
        href={href}
        transitionTypes={transitionTypes}
        // The group being read is lit with the sidebar's wash and the tile
        // in the accent's fill — never a money colour, and never on the
        // figures, which keep their own ink.
        aria-current={isCurrent ? "true" : undefined}
        aria-label={spoken}
        className={cn(
          "flex items-center rounded-[10px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
          folded
            ? "mx-auto size-11 justify-center"
            : "min-h-12 gap-2.5 px-2 py-1.5",
          isCurrent ? "bg-sidebar-accent" : "hover:bg-wash-2",
        )}
      >
        {tile}
        {/* Folded, the words leave the screen and the link keeps its name:
            the tile alone would be a colour standing for a group, and its tip
            is only there for a pointer. */}
        <span
          className={cn("flex min-w-0 flex-1 flex-col", folded && "sr-only")}
        >
          {words}
        </span>
      </Link>
    </SidebarTip>
  );
}

/*
 * The last list the sidebar drew, kept for the length of the page.
 *
 * Home and a group are two layouts, so moving between them mounts a new
 * sidebar whose list is still on its way. Rather than blank the column for
 * that moment, the waiting sidebar draws what the last one had — the same
 * groups, at most a navigation old — and the fresh list replaces it as soon
 * as it lands. Written only from an effect, so a render never mutates it.
 */
let knownGroups: readonly NavigationGroup[] | null = null;
const knownListeners = new Set<() => void>();

function subscribeToKnown(listener: () => void) {
  knownListeners.add(listener);
  return () => {
    knownListeners.delete(listener);
  };
}

/**
 * The groups the sidebar last received, or null before any have. Also what
 * the sidebar's Add asks "which group?" from, outside a group.
 */
export function useKnownGroups(): readonly NavigationGroup[] | null {
  return useSyncExternalStore(
    subscribeToKnown,
    () => knownGroups,
    () => null,
  );
}

function rememberGroups(groups: readonly NavigationGroup[]) {
  if (knownGroups === groups) return;
  knownGroups = groups;
  for (const listener of knownListeners) listener();
}

/**
 * The sidebar's list of groups, in Home's order.
 *
 * The ones with money outstanding first, needing the reader before owing
 * them; then the settled ones, folded behind one row, because a group with
 * nothing to settle is rarely where anyone is going. The group being read is
 * never folded away, settled or not: the sidebar should always show where
 * the reader is.
 */
export function SidebarGroups({
  groups,
  groupId,
  failed,
}: {
  groups: readonly NavigationGroup[];
  /** The group the screen belongs to, if it belongs to one. */
  groupId: string | null;
  /** The list could not be read; say so rather than show an empty sidebar. */
  failed?: boolean;
}) {
  useEffect(() => {
    if (!failed) rememberGroups(groups);
  }, [groups, failed]);

  return <GroupList groups={groups} groupId={groupId} failed={failed} />;
}

/**
 * What stands in while the list streams in: the last list drawn, if this page
 * has drawn one, and otherwise rows the shape of the ones on their way.
 */
export function SidebarGroupsFallback({ groupId }: { groupId: string | null }) {
  const known = useKnownGroups();
  if (known) return <GroupList groups={known} groupId={groupId} />;
  return <LoadingRows />;
}

function GroupList({
  groups,
  groupId,
  failed,
}: {
  groups: readonly NavigationGroup[];
  groupId: string | null;
  failed?: boolean;
}) {
  const t = useTranslations("nav");
  const tDashboard = useTranslations("dashboard");
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed } = useSidebar();
  const [settledOpen, setSettledOpen] = useState(false);
  const foldId = useId();

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => router.refresh()}
        className={cn(
          "rounded-[10px] px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-wash-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          collapsed && "sr-only",
        )}
      >
        {t("switcherRetry")}
      </button>
    );
  }

  if (groups.length === 0) {
    return (
      <p
        className={cn(
          "px-2.5 py-2 text-xs text-pretty text-muted-foreground",
          collapsed && "sr-only",
        )}
      >
        {t("sidebarNoGroups")}
      </p>
    );
  }

  const shown = groups.filter(
    (group) => group.direction !== "settled" || group.id === groupId,
  );
  const folded = groups.filter(
    (group) => group.direction === "settled" && group.id !== groupId,
  );

  // Into another group sideways, keeping the section; into one from outside
  // any group, deeper, the way Home's own rows go.
  const transitionTypes = groupId ? SWITCH_FORWARD : PUSH;
  const row = (group: NavigationGroup) => (
    <li key={group.id}>
      <GroupRow
        group={group}
        variant="sidebar"
        isCurrent={group.id === groupId}
        href={equivalentPath(pathname, groupId, group.id)}
        transitionTypes={transitionTypes}
      />
    </li>
  );

  const foldLabel = tDashboard("sectionSettled", { count: folded.length });

  return (
    <ul className="flex flex-col gap-0.5">
      {shown.map(row)}
      {folded.length > 0 && (
        <li>
          <SidebarTip content={foldLabel}>
            <button
              type="button"
              aria-expanded={settledOpen}
              aria-controls={foldId}
              onClick={() => setSettledOpen(!settledOpen)}
              className={cn(
                "flex items-center rounded-[10px] text-xs font-medium text-muted-foreground transition-colors hover:bg-wash-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
                collapsed
                  ? "mx-auto size-11 justify-center"
                  : "tap-target h-9 w-full gap-2 px-2.5",
              )}
            >
              {collapsed ? (
                <Ellipsis aria-hidden="true" className="size-4" />
              ) : (
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 transition-transform motion-reduce:transition-none",
                    settledOpen && "rotate-90",
                  )}
                />
              )}
              <span className={cn(collapsed && "sr-only")}>{foldLabel}</span>
            </button>
          </SidebarTip>
          <ul
            id={foldId}
            hidden={!settledOpen}
            className="mt-0.5 flex flex-col gap-0.5"
          >
            {folded.map(row)}
          </ul>
        </li>
      )}
    </ul>
  );
}

function LoadingRows() {
  const { collapsed } = useSidebar();
  return (
    <div aria-hidden="true" className="flex flex-col gap-0.5">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className={cn(
            "flex items-center",
            collapsed
              ? "mx-auto size-11 justify-center"
              : "min-h-12 gap-2.5 px-2",
          )}
        >
          <Skeleton
            className={cn(
              "rounded-[9px]",
              collapsed ? "size-8 rounded-[10px]" : "size-7",
            )}
          />
          {!collapsed && (
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-2.5 w-2/5" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
