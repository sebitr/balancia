"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  openOnContent,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { GroupIconTile } from "@/components/groups/group-icon";
import type { GroupIcon, GroupIconColor } from "@/modules/groups/icons";
import { RelativeTime } from "./relative-time";

/**
 * Which group the expense is going into, asked before the form rather than
 * inside it.
 *
 * `Add expense` has no group yet, and a group field buried in the form is a
 * worse place to answer that than a sheet that asks it first. Unfiltered the
 * list offers the few groups most recently touched, which is nearly always the
 * one meant; a query searches all of them.
 */

/** How many groups are offered before anyone types. */
const RECENT_SLOTS = 5;

export interface PickableGroup {
  readonly id: string;
  readonly name: string;
  readonly icon: GroupIcon | null;
  readonly iconColor: GroupIconColor | null;
  readonly lastActivityAt: string;
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

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle === ""
        ? groups.slice(0, RECENT_SLOTS)
        : groups.filter((group) => group.name.toLowerCase().includes(needle)),
    [needle, groups],
  );

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
        showCloseButton={false}
        // The list is the point. Most people have a handful of groups and tap
        // the one they mean; the search is for the person who has thirty.
        onOpenAutoFocus={openOnContent}
        className="gap-4 rounded-t-[22px] bg-card px-5 pt-3.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground"
      >
        <div className="flex flex-col gap-0.5">
          <SheetTitle className="text-base font-semibold tracking-[-0.02em]">
            {t("pickerTitle")}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            {needle === ""
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
          <ul className="max-h-60 [scrollbar-width:none] overflow-y-auto">
            {shown.map((group) => (
              <li key={group.id} className="border-t">
                <Link
                  href={`/groups/${group.id}/expenses/new`}
                  // No direction, for the same reason the bar's own Add has
                  // none: what arrives is the entry drawer, rising from the
                  // bottom. This is the one route into it that `screenPath`
                  // cannot hold still on its own — coming from the dashboard,
                  // the screen underneath really does change — so the absence
                  // here is doing work rather than waiting to be filled in.
                  onClick={() => onOpenChange(false)}
                  className="flex items-center gap-3 py-[13px] transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
                >
                  <GroupIconTile
                    icon={group.icon}
                    color={group.iconColor}
                    name={group.name}
                    className="size-8 rounded-[10px] bg-accent text-sm text-accent-foreground"
                    iconClassName="size-4"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
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
        )}
      </SheetContent>
    </Sheet>
  );
}
