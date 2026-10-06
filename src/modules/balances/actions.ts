"use server";

import { getCurrentUser } from "@/lib/security/actor";
import { loadNavigationGroups, type NavigationGroup } from "./navigation";

/**
 * The group list behind the phone's header switcher.
 *
 * Read on demand rather than in the group layout: the positions come from the
 * same computation the home screen runs, which walks every group's balances,
 * and paying for that on every group screen — to fill a panel most visits
 * never open — would tax the common path for the rare one. Asked for when the
 * panel opens, it costs nothing until someone wants it.
 *
 * The desktop sidebar reads the same list, from the layout itself rather than
 * through this action, and streams it in; see `navigation.ts`.
 */

/** The switcher's name for a navigation group; the shape is shared. */
export type SwitcherGroup = NavigationGroup;

/**
 * The actor's groups, most recently active first.
 *
 * Archived groups are left out, as they are on the home screen — the switcher
 * offers somewhere to go, and an archived group is not somewhere anyone is
 * going next. A guest never reaches this: the header gives them no switcher to
 * open, and with no account there would be no second group to list.
 */
export async function loadSwitcherGroups(): Promise<SwitcherGroup[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const groups = await loadNavigationGroups(user.userId);
  return [...groups].sort((a, b) =>
    b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
}
