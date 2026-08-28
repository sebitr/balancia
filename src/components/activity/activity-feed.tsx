import { getTranslations } from "next-intl/server";
import { getDateFormatter } from "@/i18n/preferences";
import type { ActivityEntry } from "@/modules/activity/service";
import { actorOf, describeActivity, type ActivityTranslate } from "./describe";

/**
 * Activity history rendering.
 *
 * Events are stored as an action plus safe metadata, so the wording lives in
 * the message catalogue rather than in the database — a phrasing change, or a
 * new language, does not require rewriting history.
 *
 * Rendered on the server, which is where the reader's date notation can be
 * read from their cookies without shipping a list renderer to the browser.
 */

export async function ActivityFeed({
  entries,
}: {
  entries: readonly ActivityEntry[];
}) {
  const t = await getTranslations("activity");
  const dates = await getDateFormatter();
  // The action id is runtime data, so its key cannot be checked at compile
  // time; `t.has` inside the helper is what makes reading it back safe.
  const translate = t as unknown as ActivityTranslate;

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        {t("empty")}
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry, index) => {
        const actor = actorOf(entry, translate);
        // Named once per run of events by the same person; see the same rule
        // in since-last-opened.tsx.
        const repeats =
          index > 0 && actorOf(entries[index - 1]!, translate) === actor;

        return (
          <li key={entry.id} className="flex gap-3 text-sm">
            <span
              aria-hidden="true"
              className="mt-2 size-1.5 shrink-0 rounded-full bg-border"
            />
            <span className="min-w-0">
              <span className="block">
                <span className={repeats ? "sr-only" : "font-medium"}>
                  {actor}{" "}
                </span>
                <span className="text-muted-foreground">
                  {describeActivity(entry, translate)}
                </span>
              </span>
              <time
                dateTime={entry.createdAt.toISOString()}
                className="text-xs text-muted-foreground"
              >
                {dates.at(entry.createdAt, { time: "short" })}
              </time>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
