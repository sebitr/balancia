"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  openOnContent,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { useDeskWidth } from "@/components/ui/use-desk-width";
import { GroupIconTile } from "@/components/groups/group-icon";
import type { GroupIcon, GroupIconColor } from "@/modules/groups/icons";
import { cn } from "@/lib/utils";
import { RelativeTime } from "./relative-time";

/**
 * Which group the expense is going into, asked before the form rather than
 * inside it.
 *
 * `Add expense` has no group yet, and a group field buried in the form is a
 * worse place to answer that than a sheet that asks it first. Unfiltered the
 * list offers the few groups most recently touched, which is nearly always the
 * one meant; a query searches all of them.
 *
 * On a desk it is a small dialog over the screen rather than a sheet along its
 * foot, and it can be answered from the keys: 1 to 9 pick the group beside
 * that number, ↑ ↓ walk the rows and ↵ takes the one with focus. Each row
 * says how many people are in the group as well as when it last moved, since
 * a desk has the line for it.
 */

/** How many groups are offered before anyone types. */
const RECENT_SLOTS = 5;

export interface PickableGroup {
  readonly id: string;
  readonly name: string;
  readonly icon: GroupIcon | null;
  readonly iconColor: GroupIconColor | null;
  readonly lastActivityAt: string;
  /** How many people are in it, for a desk's second line; absent if unknown. */
  readonly participantCount?: number;
}

export function AddExpenseSheet({
  open,
  onOpenChange,
  groups,
  now,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Most recently active first; the sheet does not re-sort. */
  groups: readonly PickableGroup[];
  now: string;
}) {
  const t = useTranslations("dashboard");
  const [query, setQuery] = useState("");
  const desk = useDeskWidth() === true;
  const list = useRef<HTMLUListElement>(null);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle === ""
        ? groups.slice(0, RECENT_SLOTS)
        : groups.filter((group) => group.name.toLowerCase().includes(needle)),
    [needle, groups],
  );

  /*
   * The keys, on a desk. A digit is a pick everywhere but the search field,
   * where it is part of a name somebody is typing — "Flat 4B". The arrows
   * walk the rows from wherever focus is, the field included, and wrap; a
   * row with focus is a link, so ↵ on it is the pick, as on any link.
   */
  const answerFromKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const links = [
      ...(list.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []),
    ];
    if (/^[1-9]$/.test(event.key)) {
      if (event.target instanceof HTMLInputElement) return;
      const link = links[Number(event.key) - 1];
      if (!link) return;
      event.preventDefault();
      link.click();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (links.length === 0) return;
    event.preventDefault();
    const at = links.findIndex((link) => link === document.activeElement);
    const next =
      event.key === "ArrowDown"
        ? (at + 1) % links.length
        : at <= 0
          ? links.length - 1
          : at - 1;
    links[next]?.focus();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // A reopened sheet asks the question again, not the last answer to it.
        if (!next) setQuery("");
      }}
    >
      <SheetContent
        side="bottom"
        // On a desk there is no swipe and no edge to push it back to, so it
        // carries a ✕ — Esc and the scrim do the same.
        showCloseButton={desk}
        desk="md"
        // The list is the point. Most people have a handful of groups and tap
        // the one they mean; the search is for the person who has thirty.
        onOpenAutoFocus={openOnContent}
        onKeyDown={desk ? answerFromKeys : undefined}
        className="gap-4 rounded-t-[22px] bg-card px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground lg:top-[7.5rem] lg:pb-0"
      >
        {/* The room above the title is on the title from `lg`, where the
            grabber that carries it on a phone has gone. */}
        <div className={cn("flex flex-col gap-0.5 lg:pt-5", desk && "pr-8")}>
          <SheetTitle className="text-base font-semibold tracking-[-0.02em]">
            {t("pickerTitle")}
          </SheetTitle>
          {/* On a desk the count is at the foot, beside the keys, so this
              line keeps saying how the list is ordered — which a search
              does not change. */}
          <p className="text-xs text-muted-foreground">
            {needle === "" || desk
              ? t("pickerSubtitle")
              : t("pickerCount", { shown: shown.length, total: groups.length })}
          </p>
        </div>

        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("pickerSearchLabel")}
            placeholder={t("pickerSearchPlaceholder")}
            className="h-10 rounded-xl pl-9 text-base md:text-sm"
          />
        </div>

        {shown.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {t("noMatch", { query: query.trim() })}
          </p>
        ) : (
          <ul
            ref={list}
            className="max-h-60 [scrollbar-width:none] overflow-y-auto lg:max-h-[min(22rem,50dvh)]"
          >
            {shown.map((group, index) => (
              <li
                key={group.id}
                className={desk ? "border-t first:border-t-0" : "border-t"}
              >
                <Link
                  href={`/groups/${group.id}/expenses/new`}
                  // No direction, for the same reason the bar's own Add has
                  // none: what arrives is the entry drawer, rising from the
                  // bottom. This is the one route into it that `screenPath`
                  // cannot hold still on its own — coming from the dashboard,
                  // the screen underneath really does change — so the absence
                  // here is doing work rather than waiting to be filled in.
                  onClick={() => onOpenChange(false)}
                  aria-keyshortcuts={
                    desk && index < 9 ? String(index + 1) : undefined
                  }
                  className={cn(
                    "flex items-center gap-3 py-[13px] transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0",
                    desk &&
                      "-mx-2 rounded-xl px-2 py-2 hover:bg-wash-1 focus-visible:bg-sidebar-accent",
                  )}
                >
                  <GroupIconTile
                    icon={group.icon}
                    color={group.iconColor}
                    name={group.name}
                    className={cn(
                      "size-8 rounded-[10px] bg-accent text-sm text-accent-foreground",
                      desk && "size-9",
                    )}
                    iconClassName="size-4"
                  />
                  {desk ? (
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {group.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {group.participantCount !== undefined && (
                          <>
                            {t("peopleCount", {
                              count: group.participantCount,
                            })}
                            {" · "}
                          </>
                        )}
                        <RelativeTime value={group.lastActivityAt} now={now} />
                      </span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {group.name}
                    </span>
                  )}
                  {!desk && (
                    <RelativeTime
                      value={group.lastActivityAt}
                      now={now}
                      className="shrink-0 text-xs text-muted-foreground"
                    />
                  )}
                  {desk && index < 9 && (
                    <Kbd aria-hidden="true">{index + 1}</Kbd>
                  )}
                  {desk && (
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* What the keys do, said once at the foot, as the desktop boards
            draw it — beside how much of the list is showing. */}
        {desk && (
          <div className="-mx-5 flex items-center gap-4 border-t px-5 py-2.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className="inline-flex items-center gap-1.5"
            >
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              {t("pickerMove")}
            </span>
            <span
              aria-hidden="true"
              className="inline-flex items-center gap-1.5"
            >
              <Kbd>↵</Kbd>
              {t("pickerChoose")}
            </span>
            <span className="ml-auto">
              {t("pickerCount", { shown: shown.length, total: groups.length })}
            </span>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
