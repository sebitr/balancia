import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PUSH } from "@/components/motion/transitions";
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
 *
 * Its "View all" opens the group's whole history, as the one beside
 * "Suggested repayments" opens every transfer. It goes when this block goes,
 * which is why the overview also ends on a row to the same screen that does
 * not depend on there being news — see `ActivityRow`.
 */

export async function SinceLastOpened({
  entries,
  lastOpenedAt,
  groupId,
  viewerId = null,
}: {
  entries: readonly ActivityEntry[];
  /** Null on a first visit, when everything counts as new. */
  lastOpenedAt: string | null;
  groupId: string;
  /** The reader's own row, so a line about them can say "you". */
  viewerId?: string | null;
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
      <div className="flex items-center justify-between gap-3">
        <h2 id="since-last-opened" className="text-sm font-medium">
          {tGroup("sinceYourLastVisit")}
        </h2>
        {/* Described by the heading beside it, so that read out of a list of
            the page's links it is not one more "View all" among several. */}
        <Link
          href={`/groups/${groupId}/activity`}
          transitionTypes={PUSH}
          aria-describedby="since-last-opened"
          className="-my-2 rounded-lg px-2 py-2 text-xs font-medium text-primary-ink transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {tGroup("viewAll")}
        </Link>
      </div>

      <ol className="flex flex-col gap-2.5 rounded-2xl px-3.5 py-3 ring-1 ring-border">
        {unseen.map((entry, index) => {
          const actor = actorOf(entry, translate);
          // A run of events by one person names them once. Seven lines that
          // all began "Demo" put the part that differs a third of the way in,
          // and the name is only news when it changes. It stays in the
          // sentence for a screen reader, which meets each line on its own.
          const repeats =
            index > 0 && actorOf(unseen[index - 1]!, translate) === actor;

          return (
            <li
              key={entry.id}
              className="flex min-w-0 items-start gap-2.5 text-sm leading-snug"
            >
              <span
                aria-hidden="true"
                className="mt-[6px] size-[5px] shrink-0 rounded-full bg-primary"
              />
              <span className="min-w-0 flex-1 text-muted-foreground">
                <span
                  className={
                    repeats ? "sr-only" : "font-medium text-foreground"
                  }
                >
                  {actor}{" "}
                </span>
                {describeActivity(entry, translate, viewerId)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
