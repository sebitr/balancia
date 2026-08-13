import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ActivityEntry } from "@/modules/activity/service";
import { actorOf, describeActivity, type ActivityTranslate } from "./describe";

/**
 * What changed while the reader was away.
 *
 * The dot is the whole idea: coral for something that happened since their last
 * visit, hairline for something they have already seen. It is reinforcement
 * rather than the message — the times are there in words, and an unseen event
 * is simply a recent one — so nothing is lost when colour is.
 *
 * The boundary comes from `lastOpenedAt`, which the page stamps *after* it has
 * rendered. A reader who lands here twice in a row therefore sees the second
 * visit as empty of news rather than as a screen that never changes.
 */

export function SinceLastOpened({
  entries,
  lastOpenedAt,
  groupId,
  now,
}: {
  entries: readonly ActivityEntry[];
  /** Null on a first visit, when everything counts as new. */
  lastOpenedAt: string | null;
  groupId: string;
  /** Pinned by the server, so relative times survive hydration unchanged. */
  now: string;
}) {
  const t = useTranslations("activity");
  const tGroup = useTranslations("group");
  const format = useFormatter();
  const translate = t as unknown as ActivityTranslate;
  const boundary = lastOpenedAt ? new Date(lastOpenedAt) : null;

  return (
    <section
      aria-labelledby="since-last-opened"
      className="flex flex-col gap-2.5"
    >
      <h2
        id="since-last-opened"
        className="text-sm font-medium text-muted-foreground"
      >
        {tGroup("sinceYouLastOpened")}
      </h2>

      <ol className="flex flex-col gap-2">
        {entries.map((entry) => {
          const unseen = boundary === null || entry.createdAt > boundary;
          return (
            <li
              key={entry.id}
              className="flex items-start gap-2 text-[0.8125rem]"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-[7px] size-[5px] shrink-0 rounded-full",
                  unseen ? "bg-primary" : "bg-border",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{actorOf(entry, translate)}</span>{" "}
                <span className="text-muted-foreground">
                  {describeActivity(entry, translate)}
                </span>
              </span>
              <time
                dateTime={entry.createdAt.toISOString()}
                title={format.dateTime(entry.createdAt, {
                  dateStyle: "long",
                  timeStyle: "short",
                })}
                className="shrink-0 text-xs text-muted-foreground"
              >
                {format.relativeTime(entry.createdAt, new Date(now))}
              </time>
            </li>
          );
        })}
      </ol>

      <Link
        href={`/groups/${groupId}/activity`}
        className="-my-1 self-start rounded-md py-2 text-[0.8125rem] font-medium text-primary transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {tGroup("showEarlierActivity")}
      </Link>
    </section>
  );
}
