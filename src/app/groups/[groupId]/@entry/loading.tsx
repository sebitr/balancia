import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";
import { ENTRY_SHEET_CLASS } from "@/components/entries/add-entry-drawer";
import { cn } from "@/lib/utils";

/**
 * The drawer's own boundary, and the slot's alone.
 *
 * `groups/[groupId]/loading.tsx` does not reach here. Parallel routes stream
 * independently and each slot answers for its own loading state, so until this
 * file existed the drawer had no boundary anywhere below the root — and a slot
 * with no boundary makes its *siblings* wait. A cold load of
 * `/groups/<id>/expenses/new` — a shared link, a refresh, a phone that dropped
 * the tab while the drawer was open — held the group page behind it hostage to
 * the drawer's six queries and painted a header, a tab bar and nothing in
 * between until they all came back.
 *
 * The second half of what a boundary buys is the reason `ScreenSkeleton`
 * exists at all, written out in full there: every page in this app reads a
 * cookie, which makes all of them dynamic, and Next will not prefetch a
 * dynamic route that has nothing to prefetch *up to*. The drawer is the most
 * opened route in the app and was the one route still paying a full server
 * round trip on the tap.
 *
 * Shaped like the sheet rather than like a page, because that is what arrives
 * next, and it carries no scrim: the group behind it is now free to render, and
 * dimming it for the moment before the real drawer does so itself would be a
 * flicker rather than a transition.
 */
export default async function EntryLoading() {
  const t = await getTranslations("common");

  return (
    <div
      role="status"
      aria-label={t("loading")}
      className={cn(
        ENTRY_SHEET_CLASS,
        "fixed inset-x-0 bottom-0 z-50 flex flex-col gap-5 border-t px-4 pt-6",
      )}
    >
      {/* The three things at the top of the form, in their own proportions:
          the tab row, the amount card, and the description block under it. */}
      <Skeleton className="h-10 w-full rounded-full" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-28 w-full rounded-2xl" />
    </div>
  );
}
