import { getLocale, getTranslations } from "next-intl/server";
import { getDateFormatter, getNumberLocale } from "@/i18n/preferences";
import {
  restorableKind,
  type ActivityEntry,
  type RestorableKind,
} from "@/modules/activity/service";
import {
  actorOf,
  amountOf,
  describeActivity,
  NOBODY,
  type ActivityPeople,
  type ActivityTranslate,
} from "./describe";
import { RestoreDeleted } from "./restore-deleted";

/**
 * Activity history rendering.
 *
 * Events are stored as an action plus safe metadata, so the wording lives in
 * the message catalogue rather than in the database — a phrasing change, or a
 * new language, does not require rewriting history.
 *
 * Rendered on the server, which is where the reader's date notation can be
 * read from their cookies without shipping a list renderer to the browser.
 *
 * Times are told on the group's clock. The app's own zone is the server's —
 * UTC unless an operator set one — and on it a group in Paris read 14:05
 * against an expense its members had added at 16:05.
 *
 * A deletion whose entry is still deleted carries a Restore, and so does the
 * removal of somebody who is still removed. Which rows those are is the page's
 * question, answered in one query before this renders; see
 * `findRestorableDeletions`.
 */

export async function ActivityFeed({
  entries,
  groupId,
  restorable,
  timeZone,
  people = NOBODY,
}: {
  entries: readonly ActivityEntry[];
  groupId: string;
  /** The ids of the rows whose entry can still be put back. */
  restorable: ReadonlySet<string>;
  /** The group's IANA zone, which every time in the feed is told in. */
  timeZone: string;
  /** The reader, and the names the events point at; see `namesInActivity`. */
  people?: ActivityPeople;
}) {
  const t = await getTranslations("activity");
  const dates = await getDateFormatter();
  const numberLocale = await getNumberLocale();
  // The action id is runtime data, so its key cannot be checked at compile
  // time; `t.has` inside the helper is what makes reading it back safe.
  const translate = t as unknown as ActivityTranslate;
  const reader = {
    ...people,
    locale: numberLocale,
    language: await getLocale(),
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
      {entries.map((entry) => {
        // Every line names who did it. A run by one person once named them on
        // its first line only, which left the lines under it with a verb and
        // no subject — and each line here carries its own time, so each is
        // read as an event of its own, not as a continuation of the one above.
        const actor = actorOf(entry, translate, people.names);
        const kind = restorableKind(entry);

        return (
          <li key={entry.id} className="flex gap-3 text-sm">
            <span
              aria-hidden="true"
              className="mt-2 size-1.5 shrink-0 rounded-full bg-border"
            />
            <span className="min-w-0 flex-1">
              <span className="block">
                <span className="font-medium">{actor} </span>
                <span className="text-muted-foreground">
                  {describeActivity(entry, translate, reader)}
                </span>
              </span>
              <time
                dateTime={entry.createdAt.toISOString()}
                className="text-xs text-muted-foreground"
              >
                {dates.at(entry.createdAt, { time: "short", timeZone })}
              </time>
            </span>
            {kind && entry.entityId && (
              <RestoreDeleted
                groupId={groupId}
                kind={kind}
                entityId={entry.entityId}
                label={restoreLabel(entry, kind, translate, numberLocale)}
                deleted={restorable.has(entry.id)}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What the Restore button is called for somebody who cannot see its row.
 *
 * "Restore" alone, read out of a list of the page's buttons, is several
 * buttons with one name. So the name carries the entry's own words — its
 * description, or for a repayment, which has none, its amount, or for a
 * person, their name as it was when they were removed — and starts with the
 * word printed on the button, so that a voice command naming what it sees
 * still reaches it.
 */
function restoreLabel(
  entry: ActivityEntry,
  kind: RestorableKind,
  t: ActivityTranslate,
  locale: string,
): string {
  const metadata = entry.metadata ?? {};
  if (kind === "participant") {
    const name = metadata.displayName;
    return typeof name === "string" && name.length > 0
      ? t("restore.participant", { name })
      : t("restore.unnamedParticipant");
  }
  if (kind === "settlement") {
    const amount = amountOf(metadata, locale);
    return amount ? t("restore.settlement", { amount }) : t("restore.unnamed");
  }
  const description = metadata.description;
  if (typeof description !== "string" || description.length === 0) {
    return t("restore.unnamed");
  }
  return t(kind === "expense" ? "restore.expense" : "restore.recurring", {
    description,
  });
}
