"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ArrowRight, BellOff, Clock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { groupDot } from "./inbox-rows";

/** How long a snooze lasts. Long enough to cover a day out, short enough to forget. */
export const SNOOZE_HOURS = 24;

/**
 * What can be done about a group, reached from its chip.
 *
 * Three options, and the middle one is the point of the sheet: muting a group
 * outright is a decision people put off, so the reversible version — quiet
 * until tomorrow — sits above it and says exactly when it wears off.
 */
export function GroupSheet({
  groupId,
  groupName,
  now,
  onOpenChange,
  onOpenGroup,
  onSnooze,
  onMute,
}: {
  groupId: string;
  groupName: string;
  now: string;
  onOpenChange: (open: boolean) => void;
  onOpenGroup: () => void;
  onSnooze: () => void;
  onMute: () => void;
}) {
  const t = useTranslations("notificationsPage");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  const wakes = new Date(Date.parse(now) + SNOOZE_HOURS * 60 * 60 * 1000);

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-[20px] px-4 pt-2 pb-[calc(1.375rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="flex-row items-center gap-2 px-0.5 pt-0 pb-3">
          <span
            aria-hidden="true"
            className={cn("size-2 rounded-full", groupDot(groupId))}
          />
          <SheetTitle className="text-sm font-semibold">{groupName}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-1.5">
          <Option
            icon={ArrowRight}
            label={t("openGroup")}
            onClick={onOpenGroup}
          />
          <Option
            icon={Clock}
            label={t("snooze")}
            onClick={onSnooze}
            meta={t("snoozeUntil", {
              time: format.dateTime(wakes, {
                hour: "numeric",
                minute: "numeric",
              }),
            })}
          />
          <Option
            icon={BellOff}
            label={t("mute", { group: groupName })}
            onClick={onMute}
          />
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="tap-target mt-1.5 h-10 rounded-xl text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
        >
          {tCommon("cancel")}
        </button>
      </SheetContent>
    </Sheet>
  );
}

function Option({
  icon: Icon,
  label,
  meta,
  onClick,
}: {
  icon: typeof ArrowRight;
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The wake time is part of what the option means, so it is part of the
      // name a screen reader reads rather than a detail beside it.
      aria-label={meta ? `${label}, ${meta}` : undefined}
      className="flex h-11 items-center gap-3 rounded-xl bg-foreground/5 px-3.5 text-left text-sm transition-colors hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta && (
        <span
          aria-hidden="true"
          className="shrink-0 text-2xs text-muted-foreground"
        >
          {meta}
        </span>
      )}
    </button>
  );
}
