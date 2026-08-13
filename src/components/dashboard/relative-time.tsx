import { useFormatter } from "next-intl";

/**
 * A moment, phrased. The absolute value stays in `datetime` and `title`, so
 * "yesterday" is never the only record of when something happened.
 *
 * `now` is pinned by the server render and passed down, otherwise the string
 * would be computed twice against two different clocks and hydration would
 * disagree with itself.
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
  const date = new Date(value);
  return (
    <time
      dateTime={value}
      title={format.dateTime(date, { dateStyle: "long" })}
      className={className}
    >
      {format.relativeTime(date, new Date(now))}
    </time>
  );
}
