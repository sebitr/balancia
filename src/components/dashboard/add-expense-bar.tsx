"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * The home screen's one action bar.
 *
 * Group pages get the five-item `GroupNav`; home has no tabs, so this is a
 * single sticky bar. "Add expense" cannot know which group is meant, so rather
 * than asking for one first it opens a picker over the screen the user is
 * already reading.
 */

export interface PickableGroup {
  readonly id: string;
  readonly name: string;
  readonly lastActivityAt: string;
}

/** Enough to cover "the group I am in right now" without becoming a list. */
const RECENT_GROUPS = 4;

export function AddExpenseBar({
  groups,
  now,
}: {
  groups: readonly PickableGroup[];
  now: string;
}) {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? groups : groups.slice(0, RECENT_GROUPS);

  return (
    <>
      <div className="sticky bottom-0 -mx-4 mt-6 border-t bg-background/95 px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <Button
            type="button"
            size="lg"
            className="h-10 flex-1 rounded-xl text-[0.9375rem]"
            onClick={() => {
              setShowAll(false);
              setOpen(true);
            }}
          >
            <Plus aria-hidden="true" className="size-[17px]" />
            {t("addExpense")}
          </Button>
          <Button
            asChild
            variant="outline"
            size="icon-lg"
            className="size-10 rounded-xl"
          >
            <Link href="/groups/new" aria-label={t("newGroup")}>
              <UserPlus aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="mx-auto max-h-[80dvh] gap-3.5 overflow-y-auto rounded-t-[22px] px-5 pt-4 pb-[max(1.375rem,env(safe-area-inset-bottom))] sm:max-w-3xl"
        >
          <span
            aria-hidden="true"
            className="mx-auto h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30"
          />
          <SheetHeader className="gap-0.5 p-0">
            <SheetTitle className="text-[1.0625rem] font-semibold tracking-[-0.02em]">
              {t("pickGroupTitle")}
            </SheetTitle>
            <SheetDescription className="text-[0.8125rem]">
              {t("pickGroupSubtitle")}
            </SheetDescription>
          </SheetHeader>

          <ul>
            {visible.map((group) => (
              <li key={group.id} className="border-b first:border-t">
                <Link
                  href={`/groups/${group.id}/expenses/new`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md py-3 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="truncate text-[0.9375rem] font-medium">
                    {group.name}
                  </span>
                  <time
                    dateTime={group.lastActivityAt}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {format.relativeTime(
                      new Date(group.lastActivityAt),
                      new Date(now),
                    )}
                  </time>
                </Link>
              </li>
            ))}
          </ul>

          {!showAll && groups.length > RECENT_GROUPS && (
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-full text-sm font-medium text-primary"
              onClick={() => setShowAll(true)}
            >
              {t("allGroups", { count: groups.length })}
            </Button>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
