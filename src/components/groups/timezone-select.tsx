"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  describeTimezone,
  filterTimezones,
  timezoneOptions,
  type TimezoneOption,
} from "@/lib/timezones";
import { cn } from "@/lib/utils";

/**
 * Timezone picker.
 *
 * A native `<select>` was fine when the list was short, but the runtime knows
 * some four hundred zones and scrolling to `Pacific/Auckland` is not a
 * reasonable ask. So: a searchable listbox, where `auck`, `pacific` and `+12`
 * all land in the same place. The value still travels in a hidden input, so
 * the surrounding form keeps posting plain form data.
 *
 * The list is built the first time the picker opens, never during the server
 * render — nobody can see it there, and the server's copy of the IANA
 * database need not agree with the browser's.
 *
 * On a phone the search field opens a keyboard over the bottom half of the
 * screen, which is where a popover anchored below its trigger lands. Radix
 * already measures against the *visual* viewport, so it will flip the list
 * above the field and shorten it — but only when something asks it to
 * recompute, and a keyboard appearing fires no event it watches. Hence
 * `updatePositionStrategy="always"`: while the list is open it re-measures
 * every frame, which also keeps it glued as the keyboard slides in.
 */

const NO_OPTIONS: readonly TimezoneOption[] = [];

export function TimezoneSelect({
  id,
  name,
  value,
  onValueChange,
  className,
}: {
  id?: string;
  name?: string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  const t = useTranslations("timezoneSelect");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** Kept as a zone rather than an index, so filtering cannot misplace it. */
  const [activeZone, setActiveZone] = useState(value);
  const baseId = useId();
  const popoverId = `${baseId}popover`;
  const listboxId = `${baseId}listbox`;
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => describeTimezone(value), [value]);

  const options = useMemo(() => {
    if (!open) return NO_OPTIONS;
    const all = timezoneOptions();
    // A value the runtime does not list — an alias, or a zone from a newer
    // database — still has to be selectable.
    return all.some((option) => option.zone === value)
      ? all
      : [selected, ...all];
  }, [open, selected, value]);

  const matches = useMemo(
    () => filterTimezones(options, query),
    [options, query],
  );

  const optionId = (zone: string) => `${listboxId}${zone}`;

  /** Keeps the highlight visible while the arrow keys walk past the fold. */
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector("[data-active]")
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeZone]);

  const openChanged = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setActiveZone(value);
    }
  };

  const queryChanged = (next: string) => {
    setQuery(next);
    // The highlight follows the search: whatever is now on top is the thing
    // Enter should pick.
    setActiveZone(filterTimezones(options, next)[0]?.zone ?? "");
  };

  const move = (delta: number) => {
    if (matches.length === 0) return;
    const current = matches.findIndex((option) => option.zone === activeZone);
    const next =
      current < 0
        ? delta > 0
          ? 0
          : matches.length - 1
        : (current + delta + matches.length) % matches.length;
    setActiveZone(matches[next].zone);
  };

  const select = (zone: string) => {
    onValueChange(zone);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        if (matches.length > 0) setActiveZone(matches[0].zone);
        break;
      case "End":
        event.preventDefault();
        if (matches.length > 0) setActiveZone(matches[matches.length - 1].zone);
        break;
      case "Enter":
        event.preventDefault();
        if (activeZone) select(activeZone);
        break;
    }
  };

  return (
    <>
      {name && <input type="hidden" name={name} value={value} />}
      <Popover open={open} onOpenChange={openChanged}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            // A combobox rather than a button: the field's label names it, and
            // its content is read as the current value — what a native select
            // announced before the list grew too long for one.
            role="combobox"
            aria-expanded={open}
            aria-controls={popoverId}
            aria-haspopup="dialog"
            className={cn(
              "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-left text-sm shadow-xs ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
              className,
            )}
          >
            <span className="truncate">{selected.label}</span>
            <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
              <span className="text-xs tabular-nums">
                {selected.offsetLabel}
              </span>
              <ChevronDown aria-hidden="true" className="size-4" />
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          id={popoverId}
          align="start"
          updatePositionStrategy="always"
          collisionPadding={8}
          className="max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) gap-0 p-0"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5">
            <Search
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => queryChanged(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("search")}
              aria-label={t("search")}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                activeZone ? optionId(activeZone) : undefined
              }
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              // `text-base` up to `md`, as everywhere else in the app: Safari
              // on iOS zooms the page when a smaller field takes focus.
              className="h-9 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
            />
          </div>

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={t("list")}
            className="max-h-64 min-h-0 flex-auto overflow-y-auto p-1"
          >
            {matches.map((option) => (
              <div
                key={option.zone}
                id={optionId(option.zone)}
                role="option"
                aria-selected={option.zone === value}
                data-active={option.zone === activeZone || undefined}
                onClick={() => select(option.zone)}
                onPointerMove={() => setActiveZone(option.zone)}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm data-active:bg-accent data-active:text-accent-foreground"
              >
                <Check
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0",
                    option.zone === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{option.label}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {option.offsetLabel}
                </span>
              </div>
            ))}
          </div>

          {matches.length === 0 && (
            <p className="shrink-0 px-3 py-6 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
