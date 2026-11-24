import Link from "next/link";
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
 * Rows sit under the day they happened on, told on the same clock, and carry
 * only the time of day: a date repeated on every row of one day is noise. A
 * row about an expense or a repayment that still exists is a link to it; a
 * deleted entry keeps its Restore and no link, since its page is gone, and an
 * event about the group or its people has nothing to open. Which entries still
 * exist is the page's question too; see `findOpenableEntries`.
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
  openable = new Set(),
  timeZone,
  people = NOBODY,
  now = new Date(),
}: {
  entries: readonly ActivityEntry[];
  groupId: string;
  /** The ids of the rows whose entry can still be put back. */
  restorable: ReadonlySet<string>;
  /** The ids of the expenses and repayments that still exist. */
  openable?: ReadonlySet<string>;
  /** The group's IANA zone, which every time in the feed is told in. */
  timeZone: string;
  /** The reader, and the names the events point at; see `namesInActivity`. */
  people?: ActivityPeople;
  /** Which day is "Today"; the clock, unless a test holds it still. */
  now?: Date;
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

  const today = dayKey(now, timeZone);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000), timeZone);

  // Newest first, as they arrive; a day's rows are always adjacent.
  const days: { key: string; at: Date; rows: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.createdAt, timeZone);
    const last = days[days.length - 1];
    if (last && last.key === key) last.rows.push(entry);
    else days.push({ key, at: entry.createdAt, rows: [entry] });
  }

  return (
    <div className="flex flex-col gap-5">
      {days.map((day) => (
        <section key={day.key} className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-muted-foreground">
            {day.key === today
              ? t("today")
              : day.key === yesterday
                ? t("yesterday")
                : dates.at(day.at, { style: "long", timeZone })}
          </h2>
          <ol className="space-y-3">
            {day.rows.map((entry) => {
              // Every line names who did it. A run by one person once named
              // them on its first line only, which left the lines under it
              // with a verb and no subject — and each line here carries its
              // own time, so each is read as an event of its own, not as a
              // continuation of the one above.
              const actor = actorOf(entry, translate, people.names, people.you);
              const kind = restorableKind(entry);
              const href = openHref(entry, groupId, openable);

              const text = (
                <>
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
                    {dates.clock(entry.createdAt, timeZone)}
                  </time>
                </>
              );

              return (
                <li key={entry.id} className="flex gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-border"
                  />
                  {href ? (
                    <Link
                      href={href}
                      className="min-w-0 flex-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {text}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1">{text}</span>
                  )}
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
        </section>
      ))}
    </div>
  );
}

/** The calendar day an instant falls on in `timeZone`, as `2026-11-24`. */
function dayKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(instant);
}

/**
 * Where a row leads, or null when there is nowhere to go.
 *
 * Only an entry that still exists, and not on the row that records its
 * deletion: that row has the Restore, and the entry it names — if it was put
 * back since — is opened from the later row that says so.
 */
function openHref(
  entry: ActivityEntry,
  groupId: string,
  openable: ReadonlySet<string>,
): string | null {
  if (!entry.entityId || !openable.has(entry.entityId)) return null;
  if (entry.action.endsWith(".deleted")) return null;
  if (entry.entityType === "expense") {
    return `/groups/${groupId}/expenses/${entry.entityId}`;
  }
  if (entry.entityType === "settlement") {
    return `/groups/${groupId}/settlements/${entry.entityId}`;
  }
  return null;
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
