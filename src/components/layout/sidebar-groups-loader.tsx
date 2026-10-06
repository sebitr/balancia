import { getCurrentUser } from "@/lib/security/actor";
import { logger } from "@/lib/logger";
import {
  loadNavigationGroups,
  type NavigationGroup,
} from "@/modules/balances/navigation";
import { SidebarGroups } from "./sidebar-groups";

/**
 * The sidebar's list of groups, read on the server and streamed in.
 *
 * The shell mounts this inside a `Suspense`, so the sidebar and the screen
 * beside it paint at once and the list — Home's own read of every group's
 * balances — arrives when it is ready rather than holding the page up. The
 * layouts that mount the shell survive navigation between their own screens,
 * so this runs on entering Home or a group and on a refresh, not on every tab.
 *
 * A failed read is said in the sidebar and goes no further: the screen beside
 * it has its own data and is not the sidebar's to take down.
 */
export async function SidebarGroupsLoader({
  groupId,
}: {
  /** The group the screen belongs to, if it belongs to one. */
  groupId: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) return null;

  let groups: NavigationGroup[] | null;
  try {
    groups = await loadNavigationGroups(user.userId);
  } catch (error) {
    logger.error({ err: error }, "Sidebar group list failed");
    groups = null;
  }

  return (
    <SidebarGroups
      groups={groups ?? []}
      groupId={groupId}
      failed={groups === null}
    />
  );
}
