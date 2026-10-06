"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import {
  rovingChoice,
  type RovingChoiceProps,
} from "@/components/ui/roving-choice";
import { cn } from "@/lib/utils";
import { scheduleSentence } from "@/components/recurring/schedule-sentence";
import { PinnedActions, PinnedBody } from "./entry-sheet";
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
  /**
   * Turns repeats off and closes. The sheet's only way out downwards — absent
   * for a rule being changed, which stays a rule.
   */
  onStop?: () => void;
}) {
  const t = useTranslations("addEntry.repeat");
  const tSchedule = useTranslations("recurring.schedule");
  const format = useFormatter();
  const dateFormatter = useDateFormatter();

  /** A rule in words, as every screen words it. See `scheduleSentence`. */
  const sentence = (patch: Partial<RecurrenceState>): string => {
    const rule = { ...state, ...patch };
    const words = scheduleSentence(
      {
        frequency: rule.frequency,
        interval: rule.interval,
        weekday: rule.weekday,
        weekOfMonth: rule.frequency === "monthly" ? rule.weekOfMonth : null,
        dayOfMonth: rule.dayOfMonth,
        monthOfYear: null,
        startDate,
      },
      {
        weekday: (day) => weekdayName(day, format),
        week: (week) => tSchedule(`week.${week}`),
        dayMonth: (day) => dateFormatter.plain(day, "dayMonth"),
      },
    );
    return tSchedule(words.key, words.values);
  };

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

  /**
   * The rule in words — the hero's first line, and the sentence in Custom.
   * The same sentence the form's row and the Recurring list show for it.
   */
  const ruleSentence = () => sentence({});

  /** What happens at the end, as the hero's second line. */
  const endsSentence = () => {
    if (state.count !== null) return t("endsAfter", { count: state.count });
    if (state.endDate !== null) {
      return t("endsOn", { date: dateFormatter.plain(state.endDate) });
    }
    return t("endsNever");
  };

  /* Each preset is labelled with the sentence it would make the rule, so the
     row a reader taps reads exactly as the rule will everywhere after. */
  const presetRules: { id: PresetId; rule: Partial<RecurrenceState> }[] = [
    { id: "daily", rule: { frequency: "daily", interval: 1 } },
    { id: "weekly", rule: { frequency: "weekly", interval: 1 } },
    { id: "fortnightly", rule: { frequency: "weekly", interval: 2 } },
    { id: "monthly", rule: { frequency: "monthly", interval: 1 } },
    { id: "yearly", rule: { frequency: "yearly", interval: 1 } },
  ];
  const presets: { id: PresetId; label: string; apply: () => void }[] =
    presetRules.map((preset) => {
      const rule = { ...preset.rule, weekOfMonth: null };
      return {
        id: preset.id,
        label: sentence(rule),
        apply: () => set(rule),
      };
    });

  /*
   * Custom is the last of the presets but not a rule of its own: choosing it
   * opens the controls below, and the rule is still whichever one they say.
   */
  const choosePreset = (id: PresetId) => {
    const option = presets.find((candidate) => candidate.id === id);
    if (option) option.apply();
    setShowCustom(option === undefined);
  };
  const presetKeys = rovingChoice<PresetId>({
    values: [...presets.map((option) => option.id), "custom"],
    selected: preset,
    onSelect: choosePreset,
  });
  const frequencyKeys = rovingChoice({
    values: RECURRENCE_FREQUENCIES,
    selected: state.frequency,
    onSelect: (frequency) =>
      set({
        frequency,
        // The nth-weekday rule only means anything monthly.
        weekOfMonth: frequency === "monthly" ? state.weekOfMonth : null,
      }),
  });

  return (
    <div className="flex min-h-0 flex-col">
      <SheetTitle className="mb-4 shrink-0 text-lg font-semibold tracking-[-0.02em]">
        {t("title")}
      </SheetTitle>

      <PinnedBody>
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
                          : "bg-wash-2 text-muted-foreground",
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
            <p className="mt-3 text-xs text-destructive-ink">
              {t("noOccurrences")}
            </p>
          )}
        </div>

        {/* A radio group that is still a list to look at: the items step out
            of the list's semantics so the rows are read as the six options
            they are, "3 of 6", rather than as list items that happen to hold
            a radio each. Focus shows the way it does on the entry form's
            cards — see `RowCard` — because the corners clip a row's own. */}
        <ul
          role="radiogroup"
          aria-label={t("title")}
          className="overflow-hidden rounded-2xl bg-card shadow-hairline has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
        >
          {presets.map((option) => (
            <li key={option.id} role="none">
              <PresetRow
                label={option.label}
                selected={preset === option.id}
                keys={presetKeys(option.id)}
                onSelect={() => choosePreset(option.id)}
              />
            </li>
          ))}
          <li role="none">
            <PresetRow
              label={t("presetCustom")}
              selected={preset === "custom"}
              keys={presetKeys("custom")}
              onSelect={() => choosePreset("custom")}
            />
          </li>
        </ul>

        {showCustom && (
          <div className="space-y-3 rounded-2xl bg-card p-4 shadow-hairline">
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
                  {...frequencyKeys(frequency)}
                  onClick={() =>
                    set({
                      frequency,
                      // The nth-weekday rule only means anything monthly.
                      weekOfMonth:
                        frequency === "monthly" ? state.weekOfMonth : null,
                    })
                  }
                  className={cn(
                    "tap-target h-9 flex-1 rounded-[9px] text-xs transition-colors",
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
                      week: tSchedule(`week.${state.weekOfMonth ?? 2}`),
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
                            {tSchedule(`week.${week}`)}
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
        <div className="overflow-hidden rounded-2xl bg-card shadow-hairline">
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
            <div className="space-y-2 border-t border-border px-4 py-3">
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
      </PinnedBody>

      <PinnedActions>
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
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="h-11 w-full text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("dontRepeat")}
          </button>
        )}
      </PinnedActions>
    </div>
  );
}

function PresetRow({
  label,
  selected,
  keys,
  onSelect,
}: {
  label: string;
  selected: boolean;
  keys: RovingChoiceProps;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      {...keys}
      onClick={onSelect}
      className="flex min-h-[52px] w-full items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-left transition-colors last:border-b-0 focus-visible:bg-accent focus-visible:outline-none active:bg-accent"
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
        "tap-target h-9 rounded-lg border text-xs tabular-nums transition-colors",
        square ? "w-full" : "px-3",
        selected
          ? "border-primary bg-primary/16 font-semibold text-foreground"
          : "border-border bg-wash-1 text-muted-foreground",
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
