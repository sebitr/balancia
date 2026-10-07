import Link from "next/link";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Today, written out — "Wednesday 12 August" — in the reader's language and
 * the zone every other date on the screen is resolved in.
 *
 * It heads the screen rather than standing for a value anyone compares, so it
 * takes the language's long form whichever numeric notation the reader chose
 * for dates: a weekday has no numeric form to choose. The languages that
 * write a weekday in lower case — "mercredi 12 août" — get their capital from
 * the line's style where it opens the line, not from editing the string.
 */
export function formatToday(
  now: Date,
  { formatLocale, timeZone }: { formatLocale: string; timeZone: string },
): string {
  return new Intl.DateTimeFormat(formatLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(now);
}

/**
 * Home's title row.
 *
 * Below `lg` it is the phone's: a title for a screen reader only, since the
 * position widget's label names the screen, and nothing else — the widget's
 * own footer offers New group. From `lg` it is drawn as the desktop board
 * "01 · Home" draws it: "Your groups", today and how many groups are open
 * under it, and New group at the right, while the widget's footer steps aside.
 *
 * The wrappers are `display: contents` below `lg`, so the title stays the
 * out-of-flow element it always was and adds nothing to the column's rhythm.
 */
export function HomeTitle({
  today,
  open,
}: {
  /** From `formatToday`. */
  today: string;
  /** Groups neither settled nor archived; the line leaves out a zero. */
  open: number;
}) {
  const t = useTranslations("dashboard");

  return (
    <div className="contents lg:flex lg:items-end lg:justify-between lg:gap-4">
      <div className="contents lg:block lg:min-w-0">
        <h1 className="sr-only lg:not-sr-only lg:font-heading lg:text-2xl lg:font-semibold lg:tracking-tight">
          {t("title")}
        </h1>
        <p className="hidden text-sm text-muted-foreground first-letter:uppercase lg:mt-0.5 lg:block">
          {open > 0 ? t("todayLine", { date: today, count: open }) : today}
        </p>
      </div>
      <Button
        asChild
        variant="outline"
        size="lg"
        className="hidden rounded-xl lg:inline-flex lg:px-3.5"
      >
        {/* Opens the create sheet on this page, as the widget's does. */}
        <Link href="?new" replace scroll={false}>
          <Plus aria-hidden="true" />
          {t("newGroup")}
        </Link>
      </Button>
    </div>
  );
}
