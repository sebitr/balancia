import type { ReactNode } from "react";
import type { DateTimeFormatOptions } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { GroupIconTile } from "@/components/groups/group-icon";
import { Badge } from "@/components/ui/badge";
import { loadGroupHeaderFacts } from "@/modules/groups/header";

/**
 * The group header's title block: the tile, the name with the currencies the
 * group keeps, and one line counting its people and entries and the days they
 * span — "6 people · 42 expenses · 2 – 12 August".
 *
 * The name is not a heading. Every screen under the header opens with its own
 * `h1` — the overview's names the group for anyone navigating by structure —
 * and a second one above it would be the page's title twice.
 *
 * Read on the server and streamed: the name is known from the layout's own
 * authorization, so `GroupHeaderFactsFallback` draws it at once, and the tile,
 * the currencies and the counts follow in the same place.
 */
export async function GroupHeaderFacts({
  groupId,
  name,
}: {
  groupId: string;
  name: string;
}) {
  const [facts, t, format] = await Promise.all([
    loadGroupHeaderFacts(groupId),
    getTranslations("group"),
    getFormatter(),
  ]);

  /*
   * Calendar dates, not instants: an entry dated 2 August is dated 2 August
   * wherever it is read from, so they are read and written in UTC and no time
   * zone gets to move them across midnight. The year only when it is not
   * this one.
   */
  const span = (() => {
    if (!facts.first || !facts.last) return null;
    const first = new Date(`${facts.first}T00:00:00Z`);
    const last = new Date(`${facts.last}T00:00:00Z`);
    const options: DateTimeFormatOptions = {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
      year:
        last.getUTCFullYear() === new Date().getUTCFullYear()
          ? undefined
          : "numeric",
    };
    return facts.first === facts.last
      ? format.dateTime(first, options)
      : format.dateTimeRange(first, last, options);
  })();

  const meta = [
    t("metaPeople", { count: facts.participantCount }),
    t("metaExpenses", { count: facts.expenseCount }),
    span,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <GroupHeaderTitle
      name={name}
      tile={
        <GroupIconTile
          icon={facts.icon}
          color={facts.iconColor}
          name={name}
          muted
          className={TILE}
          iconClassName="size-5 xl:size-6"
        />
      }
      chip={facts.currencies.length > 0 ? facts.currencies.join(" · ") : null}
      meta={meta}
    />
  );
}

/** The name at once, while the tile and the counts are on their way. */
export function GroupHeaderFactsFallback({ name }: { name: string }) {
  return (
    <GroupHeaderTitle
      name={name}
      tile={
        <GroupIconTile
          icon={null}
          color={null}
          name={name}
          muted
          className={TILE}
        />
      }
      chip={null}
      meta={null}
    />
  );
}

/**
 * In the accent's fill, as the group's own tile is lit in the sidebar beside
 * it: this is the group being read. 36px at `lg`, where the header gives way
 * first, and 48px from `xl`.
 */
const TILE =
  "size-9 rounded-[11px] bg-primary text-xs font-semibold text-primary-foreground xl:size-12 xl:rounded-[14px] xl:text-base";

function GroupHeaderTitle({
  name,
  tile,
  chip,
  meta,
}: {
  name: string;
  tile: ReactNode;
  chip: string | null;
  meta: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      {tile}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex min-w-0 items-center gap-2.5 text-xl font-semibold tracking-[-0.02em] xl:text-2xl">
          <span className="truncate">{name}</span>
          {chip && (
            <Badge variant="outline" className="shrink-0 tracking-normal">
              {chip}
            </Badge>
          )}
        </p>
        {/* Held at its height while the counts load, so the tabs below do
            not move when they land. */}
        <p className="min-h-4 truncate text-xs text-muted-foreground tabular-nums">
          {meta}
        </p>
      </div>
    </div>
  );
}
