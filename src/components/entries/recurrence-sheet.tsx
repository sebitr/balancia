"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  RECURRENCE_FREQUENCIES,
  WEEKS_OF_MONTH,
  firstOccurrence,
  nextOccurrence,
  type RecurrenceFrequency,
  type RecurrenceRule,
  type WeekOfMonth,
} from "@/modules/recurring/schedule";

/**
 * Repeat.
 *
 * Recurrence is a property of an entry here, not a separate kind of thing, so
 * a monthly rent income and a monthly cleaning expense are set up identically
 * and neither needs its own screen.
 *
 * **No toggle in the header.** You arrive by turning Repeats on, and a switch
 * that empties the sheet you have just opened is a trap: the reader taps it,
 * everything vanishes, and there is nothing left to say what happened. The way
 * out is a quiet *Don't repeat this entry* at the bottom, which also closes.
 *
 * The preview is the whole point. "Every month on the 31st" is ambiguous in
 * February, and reading back real dates — computed by the same scheduler the
 * worker uses — answers that before anyone is surprised by it. It leads rather
 * than trailing, because the outcome is what somebody is choosing between.
 *
 * Six presets cover almost everything; Custom is where the rest lives, and it
 * stays closed until asked for.
 */

/** ISO weekdays, Monday first. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** The intervals worth one tap. 5 months is a rule nobody writes. */
const INTERVALS = [1, 2, 3, 4, 6, 12] as const;

/** How many dates the hero shows before it says "and monthly after that". */
const PREVIEW_COUNT = 3;

export interface RecurrenceState {
  readonly enabled: boolean;
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  readonly weekday: number;
  readonly dayOfMonth: number;
  /**
   * Which occurrence of `weekday` in the month, for "the second Tuesday".
   *
   * Null means the rule goes by `dayOfMonth` instead. The two are exclusive —
   * a rule is one or the other — and `validateRule` refuses the pair rather
   * than picking a winner.
   */
  readonly weekOfMonth: WeekOfMonth | null;
  readonly endDate: string | null;
  /** Stop after this many occurrences. Exclusive with `endDate`. */
  readonly count: number | null;
}

/** The state as the scheduler wants it. */
function ruleFor(
  state: RecurrenceState,
  startDate: string,
  timezone: string,
): RecurrenceRule {
  const monthly = state.frequency === "monthly";
  const byWeekday = monthly && state.weekOfMonth !== null;
  return {
    frequency: state.frequency,
    interval: state.interval,
    weekday: state.frequency === "weekly" || byWeekday ? state.weekday : null,
    weekOfMonth: byWeekday ? state.weekOfMonth : null,
    dayOfMonth:
      state.frequency === "daily" || state.frequency === "weekly" || byWeekday
        ? null
        : state.dayOfMonth,
    monthOfYear: null,
    timezone,
    startDate,
    endDate: state.endDate,
    count: state.count,
  };
}

/**
 * The next few dates a rule would produce, from the real scheduler.
 *
 * Wrapped because an in-progress rule can be invalid — day 31 of a weekly
 * schedule, an end date before the start — and a preview that threw would take
 * whatever is rendering it down too.
 *
 * Shared with the form, whose repeats row states the same dates. Two
 * implementations of "when does this next happen" is one more than a schedule
 * can survive.
 */
export function upcomingOccurrences(
  state: RecurrenceState,
  startDate: string,
  timezone: string,
  limit = PREVIEW_COUNT,
): string[] {
  if (!state.enabled) return [];
  try {
    const rule = ruleFor(state, startDate, timezone);
    const dates: string[] = [];
    let current = firstOccurrence(rule);
    while (current && dates.length < limit) {
      dates.push(current);
      current = nextOccurrence(rule, current);
    }
    return dates;
  } catch {
    return [];
  }
}

/** Which preset row, if any, the current rule *is*. */
type PresetId =
  "daily" | "weekly" | "fortnightly" | "monthly" | "yearly" | "custom";

function presetOf(state: RecurrenceState): PresetId {
  const { frequency, interval, weekOfMonth } = state;
  if (frequency === "daily" && interval === 1) return "daily";
  if (frequency === "weekly" && interval === 1) return "weekly";
  if (frequency === "weekly" && interval === 2) return "fortnightly";
  if (frequency === "monthly" && interval === 1 && weekOfMonth === null) {
    return "monthly";
  }
  if (frequency === "yearly" && interval === 1) return "yearly";
  return "custom";
}

export function RecurrenceSheet({
  state,
  onChange,
  startDate,
  timezone,
  onDone,
  onStop,
}: {
  state: RecurrenceState;
  onChange: (next: RecurrenceState) => void;
  /** The entry's own date — the schedule starts from it. */
  startDate: string;
  timezone: string;
  onDone: () => void;
  /** Turns repeats off and closes. The sheet's only way out downwards. */
  onStop: () => void;
}) {
  const t = useTranslations("addEntry.repeat");
  const format = useFormatter();
  const dateFormatter = useDateFormatter();

  const preset = presetOf(state);
  /* Custom opens itself for a rule that is already one, so reopening a
     fortnightly-on-Thursday does not hide the half that made it custom. */
  const [showCustom, setShowCustom] = useState(preset === "custom");
  const [showEnds, setShowEnds] = useState(false);

  const set = (patch: Partial<RecurrenceState>) =>
    onChange({ ...state, ...patch });

  const upcoming = useMemo(
    () => upcomingOccurrences(state, startDate, timezone, PREVIEW_COUNT + 1),
    [state, startDate, timezone],
  );
  const shown = upcoming.slice(0, PREVIEW_COUNT);
  const more = upcoming.length > PREVIEW_COUNT;

  /** The rule in words — the hero's first line, and the sentence in Custom. */
  const ruleSentence = () => {
    if (state.frequency === "monthly" && state.weekOfMonth !== null) {
      return t("byWeekday", {
        week: t(`weeks.${state.weekOfMonth}`),
        day: weekdayName(state.weekday, format),
      });
    }
    /* "Every 1 month" is what a generic sentence produces and not what
       anybody says. One of anything gets its own wording. */
    if (state.interval === 1) return t(`everyOne.${state.frequency}`);
    return t("everyN", {
      interval: t(`interval.${state.frequency}`, { count: state.interval }),
    });
  };

  /** What happens at the end, as the hero's second line. */
  const endsSentence = () => {
    if (state.count !== null) return t("endsAfter", { count: state.count });
    if (state.endDate !== null) {
      return t("endsOn", { date: dateFormatter.plain(state.endDate) });
    }
    return t("endsNever");
  };

  const presets: { id: PresetId; label: string; apply: () => void }[] = [
    {
      id: "daily",
      label: t("presetDaily"),
      apply: () => set({ frequency: "daily", interval: 1, weekOfMonth: null }),
    },
    {
      id: "weekly",
      label: t("presetWeekly", { day: weekdayName(state.weekday, format) }),
      apply: () => set({ frequency: "weekly", interval: 1, weekOfMonth: null }),
    },
    {
      id: "fortnightly",
      label: t("presetFortnightly", {
        day: weekdayName(state.weekday, format),
      }),
      apply: () => set({ frequency: "weekly", interval: 2, weekOfMonth: null }),
    },
    {
      id: "monthly",
      label: t("presetMonthly", { day: state.dayOfMonth }),
      apply: () =>
        set({ frequency: "monthly", interval: 1, weekOfMonth: null }),
    },
    {
      id: "yearly",
      label: t("presetYearly", {
        date: dateFormatter.plain(startDate, "dayMonth"),
      }),
      apply: () => set({ frequency: "yearly", interval: 1, weekOfMonth: null }),
    },
  ];

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <SheetTitle className="shrink-0 text-lg font-semibold tracking-[-0.02em]">
        {t("title")}
      </SheetTitle>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto [&>*]:shrink-0">
        {/* The outcome, before the controls that produce it. */}
        <div className="rounded-2xl bg-primary/8 p-4">
          <p className="text-lg font-semibold tracking-[-0.02em]">
            {ruleSentence()}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {endsSentence()}
          </p>

          {shown.length > 0 ? (
            <>
              <p className="mt-3 text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                {t("nextLabel")}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {shown.map((date, index) => (
                  <li key={date}>
                    <span
                      className={cn(
                        "inline-flex h-8 items-center rounded-full px-3 text-xs tabular-nums",
                        index === 0
                          ? "bg-primary/16 font-semibold text-foreground"
                          : "bg-white/6 text-muted-foreground",
                      )}
                    >
                      {dateFormatter.plain(date, "dayMonth")}
                    </span>
                  </li>
                ))}
              </ul>
              {more && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("andAfter", { rule: ruleSentence().toLocaleLowerCase() })}
                </p>
              )}
            </>
          ) : (
            /* A rule with no occurrences is a rule nobody can save, and the
               hero is where that has to be said — the Done button below only
               refuses. */
            <p className="text-destructive-ink mt-3 text-xs">
              {t("noOccurrences")}
            </p>
          )}
        </div>

        <ul className="overflow-hidden rounded-2xl bg-card shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
          {presets.map((option) => (
            <li key={option.id}>
              <PresetRow
                label={option.label}
                selected={preset === option.id}
                onSelect={() => {
                  option.apply();
                  setShowCustom(false);
                }}
              />
            </li>
          ))}
          <li>
            <PresetRow
              label={t("presetCustom")}
              selected={preset === "custom"}
              onSelect={() => setShowCustom(true)}
            />
          </li>
        </ul>

        {showCustom && (
          <div className="space-y-3 rounded-2xl bg-card p-4 shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
            <div
              role="radiogroup"
              aria-label={t("title")}
              className="flex gap-1 rounded-xl bg-muted p-1"
            >
              {RECURRENCE_FREQUENCIES.map((frequency) => (
                <button
                  key={frequency}
                  type="button"
                  role="radio"
                  aria-checked={frequency === state.frequency}
                  onClick={() =>
                    set({
                      frequency,
                      // The nth-weekday rule only means anything monthly.
                      weekOfMonth:
                        frequency === "monthly" ? state.weekOfMonth : null,
                    })
                  }
                  className={cn(
                    "h-9 flex-1 rounded-[9px] text-xs transition-colors",
                    frequency === state.frequency
                      ? "bg-accent font-semibold text-foreground"
                      : "font-medium text-muted-foreground",
                  )}
                >
                  {t(`frequency.${frequency}`)}
                </button>
              ))}
            </div>

            {/* The sentence above the chips, so the number has a meaning
                before it is chosen rather than after. */}
            <p className="text-sm font-semibold">{ruleSentence()}</p>
            <ul className="flex flex-wrap gap-1.5">
              {INTERVALS.map((interval) => (
                <li key={interval}>
                  <ChipButton
                    selected={interval === state.interval}
                    onClick={() => set({ interval })}
                  >
                    {interval}
                  </ChipButton>
                </li>
              ))}
            </ul>

            {state.frequency === "weekly" && (
              <ul className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((weekday) => (
                  <li key={weekday}>
                    <ChipButton
                      selected={weekday === state.weekday}
                      onClick={() => set({ weekday })}
                    >
                      {shortWeekdayName(weekday, format)}
                    </ChipButton>
                  </li>
                ))}
              </ul>
            )}

            {state.frequency === "monthly" && (
              <>
                <div className="flex gap-1.5">
                  <ChipButton
                    selected={state.weekOfMonth === null}
                    onClick={() => set({ weekOfMonth: null })}
                  >
                    {t("byDayOfMonth", { day: state.dayOfMonth })}
                  </ChipButton>
                  <ChipButton
                    selected={state.weekOfMonth !== null}
                    onClick={() => set({ weekOfMonth: state.weekOfMonth ?? 2 })}
                  >
                    {t("byWeekday", {
                      week: t(`weeks.${state.weekOfMonth ?? 2}`),
                      day: weekdayName(state.weekday, format),
                    })}
                  </ChipButton>
                </div>

                {state.weekOfMonth === null ? (
                  <>
                    <ul className="grid grid-cols-7 gap-1">
                      {Array.from({ length: 31 }, (_, index) => index + 1).map(
                        (day) => (
                          <li key={day}>
                            <ChipButton
                              selected={day === state.dayOfMonth}
                              onClick={() => set({ dayOfMonth: day })}
                              square
                            >
                              {day}
                            </ChipButton>
                          </li>
                        ),
                      )}
                    </ul>
                    <ChipButton
                      selected={state.dayOfMonth === 31}
                      onClick={() => set({ dayOfMonth: 31 })}
                    >
                      {t("lastDayOfMonth")}
                    </ChipButton>
                    {/* The clamp, said out loud: a rule on the 31st does not
                        skip February, it lands on its last day. */}
                    <p className="text-xs text-muted-foreground">
                      {t("shortMonthNote")}
                    </p>
                  </>
                ) : (
                  <>
                    <ul className="flex flex-wrap gap-1.5">
                      {WEEKS_OF_MONTH.map((week) => (
                        <li key={String(week)}>
                          <ChipButton
                            selected={week === state.weekOfMonth}
                            onClick={() => set({ weekOfMonth: week })}
                          >
                            {t(`weeks.${week}`)}
                          </ChipButton>
                        </li>
                      ))}
                    </ul>
                    <ul className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((weekday) => (
                        <li key={weekday}>
                          <ChipButton
                            selected={weekday === state.weekday}
                            onClick={() => set({ weekday })}
                          >
                            {shortWeekdayName(weekday, format)}
                          </ChipButton>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/*
         * Ends is one row nine times out of ten, because "Never" is the answer
         * nine times out of ten. It states its value and expands when the
         * tenth reader disagrees.
         */}
        <div className="overflow-hidden rounded-2xl bg-card shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
          <button
            type="button"
            onClick={() => setShowEnds((open) => !open)}
            aria-expanded={showEnds}
            className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
          >
            <span className="text-sm font-medium">{t("ends")}</span>
            <span className="truncate text-sm text-muted-foreground">
              {state.count !== null
                ? t("timesCount", { count: state.count })
                : state.endDate !== null
                  ? dateFormatter.plain(state.endDate, "dayMonth")
                  : t("never")}
            </span>
          </button>

          {showEnds && (
            <div className="space-y-2 border-t border-white/8 px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                <ChipButton
                  selected={state.endDate === null && state.count === null}
                  onClick={() => set({ endDate: null, count: null })}
                >
                  {t("never")}
                </ChipButton>
                <ChipButton
                  selected={state.endDate !== null}
                  onClick={() =>
                    set({ endDate: endOfYear(startDate), count: null })
                  }
                >
                  {t("onADate")}
                </ChipButton>
                <ChipButton
                  selected={state.count !== null}
                  onClick={() =>
                    set({ count: state.count ?? 12, endDate: null })
                  }
                >
                  {t("afterTimes")}
                </ChipButton>
              </div>

              {state.endDate !== null && (
                <Input
                  type="date"
                  value={state.endDate}
                  min={startDate}
                  aria-label={t("onADate")}
                  onChange={(event) =>
                    set({ endDate: event.target.value || null })
                  }
                />
              )}

              {state.count !== null && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={520}
                    value={state.count}
                    aria-label={t("afterTimes")}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      set({
                        count: Number.isFinite(next) && next >= 1 ? next : 1,
                      });
                    }}
                    className="w-24"
                  />
                  {[6, 12, 24].map((times) => (
                    <ChipButton
                      key={times}
                      selected={state.count === times}
                      onClick={() => set({ count: times })}
                    >
                      {t("timesCount", { count: times })}
                    </ChipButton>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {t("timezoneNote", { timezone })}
        </p>
      </div>

      <div className="shrink-0 space-y-2 pt-1">
        <Button
          type="button"
          size="lg"
          className="h-13 w-full"
          disabled={shown.length === 0}
          onClick={() => {
            // Guarded here as well as disabled: a rule that produces nothing
            // is one the server refuses, and `disabled` is an affordance.
            if (shown.length === 0) return;
            onDone();
          }}
        >
          {t("done")}
        </Button>
        {/*
         * The way out, and the reason there is no switch in the header. Quiet,
         * because turning it off is not what most readers came to do.
         */}
        <button
          type="button"
          onClick={onStop}
          className="h-11 w-full text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("dontRepeat")}
        </button>
      </div>
    </div>
  );
}

function PresetRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex min-h-[52px] w-full items-center justify-between gap-3 border-b border-white/8 px-4 py-2.5 text-left transition-colors last:border-b-0 active:bg-accent"
    >
      <span className="truncate text-sm">{label}</span>
      {selected && (
        <Check
          aria-hidden="true"
          className="size-4 shrink-0 text-primary-ink"
        />
      )}
    </button>
  );
}

function ChipButton({
  children,
  selected,
  onClick,
  square = false,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  square?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "h-9 rounded-lg border text-xs tabular-nums transition-colors",
        square ? "w-full" : "px-3",
        selected
          ? "border-primary bg-primary/16 font-semibold text-foreground"
          : "border-border bg-white/4 text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
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

function shortWeekdayName(
  weekday: number,
  format: ReturnType<typeof useFormatter>,
): string {
  const reference = new Date(Date.UTC(2024, 0, 1 + (weekday - 1)));
  return format.dateTime(reference, { weekday: "short", timeZone: "UTC" });
}
