import { ScreenSkeleton } from "@/components/layout/screen-skeleton";

/**
 * Stands in for every screen inside a group — the tab bar's four destinations
 * and everything they lead to — so all of them can be prefetched. The group
 * shell above it, header and bottom bar included, is already on screen and
 * does not flicker.
 */
export default function GroupLoading() {
  return <ScreenSkeleton rows={4} />;
}
