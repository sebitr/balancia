import { useFormatter, useTranslations } from "next-intl";
import type { ActivityEntry } from "@/modules/activity/service";

/**
 * Activity history rendering.
 *
 * Events are stored as an action plus safe metadata, so the wording lives in
 * the message catalogue rather than in the database — a phrasing change, or a
 * new language, does not require rewriting history.
 *
 * Action ids are dotted ("expense.created"), which is also how next-intl
 * addresses nested keys, so an id maps straight onto `actions.expense.created`.
 * An id with no entry falls back to the raw value: an event written by a newer
 * version should still show something rather than break the page.
 */

export function ActivityFeed({
  entries,
}: {
  entries: readonly ActivityEntry[];
}) {
  const t = useTranslations("activity");
  const format = useFormatter();

  const describe = (entry: ActivityEntry): string => {
    // The id is runtime data, so the key cannot be checked at compile time;
    // `t.has` is what makes reading it back safe.
    const key = `actions.${entry.action}` as Parameters<typeof t.has>[0];
    const base = t.has(key) ? t(key) : entry.action;
    const description = entry.metadata?.description;
    if (typeof description === "string" && description.length > 0) {
      return t("withDescription", { action: base, description });
    }
    return base;
  };

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        {t("empty")}
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3 text-sm">
          <span
            aria-hidden="true"
            className="mt-2 size-1.5 shrink-0 rounded-full bg-border"
          />
          <span className="min-w-0">
            <span className="block">
              <span className="font-medium">
                {entry.actorLabel ??
                  (entry.actorType === "system" ? "Balancia" : t("someone"))}
              </span>{" "}
              <span className="text-muted-foreground">{describe(entry)}</span>
            </span>
            <time
              dateTime={entry.createdAt.toISOString()}
              className="text-xs text-muted-foreground"
            >
              {format.dateTime(entry.createdAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </span>
        </li>
      ))}
    </ol>
  );
}
