import { getTranslations } from "next-intl/server";
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

export async function SinceLastOpened({
  entries,
  lastOpenedAt,
}: {
  entries: readonly ActivityEntry[];
  /** Null on a first visit, when everything counts as new. */
  lastOpenedAt: string | null;
  groupId: string;
  /** Pinned by the server, so relative times survive hydration unchanged. */
  now: string;
}) {
  const t = await getTranslations("activity");
  const tGroup = await getTranslations("group");
  const translate = t as unknown as ActivityTranslate;
  const boundary = lastOpenedAt ? new Date(lastOpenedAt) : null;
  const unseen = entries.filter(
    (entry) => boundary === null || entry.createdAt > boundary,
  );

  if (unseen.length === 0) return null;

  return (
    <section
      aria-labelledby="since-last-opened"
      className="flex flex-col gap-2.5"
    >
      <h2 id="since-last-opened" className="text-sm font-medium">
        {tGroup("sinceYourLastVisit")}
      </h2>

      <ol className="flex flex-col gap-2.5 rounded-2xl px-3.5 py-3 ring-1 ring-border">
        {unseen.map((entry) => (
          <li
            key={entry.id}
            className="flex min-w-0 items-start gap-2.5 text-[0.84375rem] leading-snug"
          >
            <span
              aria-hidden="true"
              className="mt-[6px] size-[5px] shrink-0 rounded-full bg-primary"
            />
            <span className="min-w-0 flex-1 text-muted-foreground">
              <span className="font-medium text-foreground">
                {actorOf(entry, translate)}
              </span>{" "}
              {describeActivity(entry, translate)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
