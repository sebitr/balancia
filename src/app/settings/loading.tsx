import { ScreenSkeleton } from "@/components/layout/screen-skeleton";

/**
 * Stands in for the settings hub and every screen under it, so all of them
 * can be prefetched — without it the rows of the hub, which are nothing but
 * links, each waited on a server round trip before the screen could move.
 *
 * Settings draws its own gutter rather than inheriting `<Screen>`'s (see
 * `SettingsScreen`), so the placeholder is given the same one here, the top
 * safe area included — and, from `lg` up, none at all, because there it
 * stands in the right-hand pane, whose column is the gutter.
 */
export default function SettingsLoading() {
  return (
    <div className="px-3.5 pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:px-0 lg:pt-0">
      <ScreenSkeleton rows={4} />
    </div>
  );
}
