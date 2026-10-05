import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, History } from "lucide-react";
import { PUSH } from "@/components/motion/transitions";
import { restorableKind, type ActivityEntry } from "@/modules/activity/service";

/**
 * The way to the group's full history, at the foot of the overview.
 *
 * The dialogs that delete an entry, stop a recurring expense or remove a
 * person all say it can be restored "later from Activity", and for a long
 * time nothing on any screen led there: the screen existed, its Restore
 * worked, and the only way in was typing the address. "Since your last visit"
 * links there too, but only renders when something is new, and a reader who
 * has just deleted something has, by definition, already seen it. So this row
 * is there whether or not anything is new.
 *
 * Drawn as the statistics row at the foot of the spending card is — icon,
 * title, caption, chevron — because the two are the same kind of thing: a
 * screen this one hands the detail to.
 */
export function ActivityRow({ groupId }: { groupId: string }) {
  const t = useTranslations("group");

  return (
    <Link
      href={`/groups/${groupId}/activity`}
      transitionTypes={PUSH}
      // The title and caption are stacked spans, which an accessible name
      // runs together with nothing between them; see the statistics row.
      aria-label={`${t("activityTitle")} · ${t("activityCaption")}`}
      className="flex min-h-12 items-center gap-2.5 rounded-2xl bg-card px-4 py-2.5 ring-1 ring-border transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
    >
      <History
        aria-hidden="true"
        className="size-[17px] shrink-0 text-primary-ink"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium">
          {t("activityTitle")}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {t("activityCaption")}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}

/**
 * Whether a group with nothing in it yet should still offer its history.
 *
 * A brand-new group's history is its own creation and the names typed in with
 * it, which the "Start here" card already shows; a row leading to two lines
 * saying so would be one more thing on the one screen whose whole job is
 * "add the first expense". But a group can be empty *again*: delete its only
 * expense, and the overview falls back to the empty state at the very moment
 * the dialog has promised the expense can be restored from Activity. So the
 * row comes back as soon as the history holds a deletion of the kind Activity
 * puts back — an entry, a recurring expense, a person removed — whether or
 * not this reader is the one allowed to press Restore, and whether or not it
 * has been put back since: a row too many is cheaper than a promise broken.
 */
export function historyHoldsADeletion(
  entries: readonly ActivityEntry[],
): boolean {
  return entries.some((entry) => restorableKind(entry) !== null);
}
