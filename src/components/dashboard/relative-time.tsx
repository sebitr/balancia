"use client";

import { useFormatter } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";

/**
 * A moment, phrased. The absolute value stays in `datetime` and `title`, so
 * "yesterday" is never the only record of when something happened.
 *
 * `now` is pinned by the server render and passed down, otherwise the string
 * would be computed twice against two different clocks and hydration would
 * disagree with itself.
 *
 * Renders on the client because the title spells the date out, and how this
 * reader writes a date is held in context (see `format-context.tsx`). Both
 * props are strings, so a server page renders it as a leaf.
 */
export function RelativeTime({
  value,
  now,
  className,
}: {
  value: string;
  now: string;
  className?: string;
}) {
  const format = useFormatter();
  const dates = useDateFormatter();
  const date = new Date(value);
  return (
    <time
      dateTime={value}
      title={dates.at(date, { style: "long" })}
      className={className}
    >
      {format.relativeTime(date, new Date(now))}
    </time>
  );
}
