"use client";

import { useMemo } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  firstOccurrence,
  nextOccurrence,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from "@/modules/recurring/schedule";

/**
 * Repeat.
 *
 * Recurrence is a property of an entry here, not a separate kind of thing, so
 * a monthly rent income and a monthly cleaning expense are set up identically
 * and neither needs its own screen.
 *
 * The preview is the whole point of the sheet. "Every 1 month on the 31st" is
 * ambiguous in February, and reading back three real dates — computed by the
 * same scheduler the worker uses — answers that before anyone is surprised by
 * it. The timezone is named for the same reason.
 */

const FREQUENCIES: readonly RecurrenceFrequency[] = [
  "weekly",
  "monthly",
  "yearly",
];

/** ISO weekdays, Monday first. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface RecurrenceState {
  readonly enabled: boolean;
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  readonly weekday: number;
  readonly dayOfMonth: number;
  readonly endDate: string | null;
}

export function RecurrenceSheet({
  state,
  onChange,
  startDate,
  timezone,
  onDone,
}: {
  state: RecurrenceState;
  onChange: (next: RecurrenceState) => void;
  /** The entry's own date — the schedule starts from it. */
  startDate: string;
  timezone: string;
  onDone: () => void;
}) {
  const t = useTranslations("addEntry.repeat");
  const format = useFormatter();
  // Named apart from the `dates` array the preview builds below.
  const dateFormatter = useDateFormatter();

  const set = <K extends keyof RecurrenceState>(
    key: K,
    value: RecurrenceState[K],
  ) => onChange({ ...state, [key]: value });

  /**
   * The next three dates, from the real scheduler.
   *
   * Wrapped because an in-progress rule can be invalid — day 31 of a weekly
   * schedule, an end date before the start — and a preview that throws would
   * take the sheet down with it.
   */
  const upcoming = useMemo(() => {
    if (!state.enabled) return [];
    const rule: RecurrenceRule = {
      frequency: state.frequency,
      interval: state.interval,
      weekday: state.frequency === "weekly" ? state.weekday : null,
      dayOfMonth: state.frequency === "weekly" ? null : state.dayOfMonth,
      monthOfYear: null,
      timezone,
      startDate,
      endDate: state.endDate,
    };
    try {
      const dates: string[] = [];
      let current = firstOccurrence(rule);
      while (current && dates.length < 3) {
        dates.push(current);
        current = nextOccurrence(rule, current);
      }
      return dates;
    } catch {
      return [];
    }
  }, [state, startDate, timezone]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <SheetTitle className="text-[19px] font-semibold tracking-[-0.02em]">
          {t("title")}
        </SheetTitle>
        <Switch
          checked={state.enabled}
          onCheckedChange={(checked) => set("enabled", checked)}
          aria-label={t("title")}
        />
      </div>

      {state.enabled && (
        <>
          <div className="flex gap-1 rounded-xl bg-muted p-1">
            {FREQUENCIES.map((frequency) => (
              <button
                key={frequency}
                type="button"
                onClick={() => set("frequency", frequency)}
                aria-pressed={frequency === state.frequency}
                className={cn(
                  "h-9 flex-1 rounded-[9px] text-[13px] transition-colors",
                  frequency === state.frequency
                    ? "bg-accent font-semibold text-foreground"
                    : "font-medium text-muted-foreground",
                )}
              >
                {t(`frequency.${frequency}`)}
              </button>
            ))}
          </div>

          <Stepper
            label={t("every")}
            value={t(`interval.${state.frequency}`, { count: state.interval })}
            onDecrement={() => set("interval", Math.max(1, state.interval - 1))}
            onIncrement={() =>
              set("interval", Math.min(12, state.interval + 1))
            }
            decrementLabel={t("fewer")}
            incrementLabel={t("more")}
          />

          {state.frequency === "weekly" ? (
            <Stepper
              label={t("onDay")}
              value={weekdayName(state.weekday, format)}
              onDecrement={() =>
                set("weekday", cycle(state.weekday, -1, WEEKDAYS.length))
              }
              onIncrement={() =>
                set("weekday", cycle(state.weekday, 1, WEEKDAYS.length))
              }
              decrementLabel={t("previousDay")}
              incrementLabel={t("nextDay")}
            />
          ) : (
            <Stepper
              label={t("onDay")}
              value={t("dayOfMonth", { day: state.dayOfMonth })}
              onDecrement={() =>
                set("dayOfMonth", cycle(state.dayOfMonth, -1, 31))
              }
              onIncrement={() =>
                set("dayOfMonth", cycle(state.dayOfMonth, 1, 31))
              }
              decrementLabel={t("previousDay")}
              incrementLabel={t("nextDay")}
            />
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{t("ends")}</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => set("endDate", null)}
                aria-pressed={state.endDate === null}
                className={cn(
                  "h-8 rounded-lg border border-border px-3 text-[13px] transition-colors",
                  state.endDate === null
                    ? "bg-accent font-semibold"
                    : "text-muted-foreground",
                )}
              >
                {t("never")}
              </button>
              <button
                type="button"
                onClick={() => set("endDate", endOfYear(startDate))}
                aria-pressed={state.endDate !== null}
                className={cn(
                  "h-8 rounded-lg border border-border px-3 text-[13px] transition-colors",
                  state.endDate !== null
                    ? "bg-accent font-semibold"
                    : "text-muted-foreground",
                )}
              >
                {state.endDate
                  ? dateFormatter.plain(state.endDate, "dayMonth")
                  : t("onADate")}
              </button>
            </div>
          </div>

          {upcoming.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("preview", {
                dates: upcoming
                  .map((date) => dateFormatter.plain(date, "dayMonth"))
                  .join(", "),
                timezone,
              })}
            </p>
          )}
        </>
      )}

      <Button type="button" size="lg" className="h-13" onClick={onDone}>
        {t("done")}
      </Button>
    </div>
  );
}

function Stepper({
  label,
  value,
  onDecrement,
  onIncrement,
  decrementLabel,
  incrementLabel,
}: {
  label: string;
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementLabel: string;
  incrementLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <StepButton onClick={onDecrement} label={decrementLabel}>
          <Minus aria-hidden="true" className="size-4" />
        </StepButton>
        <span className="min-w-[86px] text-center text-sm font-semibold">
          {value}
        </span>
        <StepButton onClick={onIncrement} label={incrementLabel}>
          <Plus aria-hidden="true" className="size-4" />
        </StepButton>
      </div>
    </div>
  );
}

function StepButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-10 items-center justify-center rounded-lg border border-border bg-white/4 transition-colors active:bg-white/12"
    >
      {children}
    </button>
  );
}

/** Wraps around rather than clamping, so holding either end keeps working. */
function cycle(value: number, delta: number, max: number): number {
  return ((value - 1 + delta + max) % max) + 1;
}

/** 31 December of the entry's own year — the design's one-tap end date. */
function endOfYear(startDate: string): string {
  return `${startDate.slice(0, 4)}-12-31`;
}

/** Any Monday works as a reference; only the weekday name is wanted. */
function weekdayName(
  weekday: number,
  format: ReturnType<typeof useFormatter>,
): string {
  const reference = new Date(Date.UTC(2024, 0, 1 + (weekday - 1)));
  return format.dateTime(reference, { weekday: "long", timeZone: "UTC" });
}
