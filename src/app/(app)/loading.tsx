import { ScreenSkeleton } from "@/components/layout/screen-skeleton";

/** Stands in for the signed-in screens outside a group: the dashboard, the
 * profile pages and the notification list. */
export default function AppLoading() {
  return <ScreenSkeleton rows={3} />;
}
