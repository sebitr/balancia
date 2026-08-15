"use server";

import { getCurrentUser } from "@/lib/security/actor";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import {
  isGroupIcon,
  isGroupIconColor,
  type GroupIcon,
  type GroupIconColor,
} from "@/modules/groups/icons";
import {
  directionOf,
  displayAmountsOf,
  loadHomeOverview,
  type GroupPosition,
  type PositionDirection,
} from "./overview";

/**
 * The group list behind the header switcher.
 *
 * Read on demand rather than in the group layout: the positions come from the
 * same computation the home screen runs, which walks every group's balances,
 * and paying for that on every group screen — to fill a panel most visits
 * never open — would tax the common path for the rare one. Asked for when the
 * panel opens, it costs nothing until someone wants it.
 *
 * It is the home screen's query path, not a second one; only the moment it
 * runs at is different.
 */

export interface SwitcherGroup {
  readonly id: string;
  readonly name: string;
  readonly icon: GroupIcon | null;
  readonly iconColor: GroupIconColor | null;
  /** Which way the group leans; "settled" when there is nothing outstanding. */
  readonly direction: PositionDirection;
  /**
   * The group's own figures, unconverted and unsigned — the direction above
   * carries the sign. Empty when settled.
   */
  readonly amounts: readonly { minorUnits: string; currency: string }[];
}

function toSwitcherGroup(position: GroupPosition): SwitcherGroup {
  const { group } = position;
  return {
    id: group.id,
    name: group.name,
    icon: isGroupIcon(group.icon) ? group.icon : null,
    iconColor: isGroupIconColor(group.iconColor) ? group.iconColor : null,
    direction: directionOf(position),
    amounts: displayAmountsOf(position).map((amount) => ({
      // Unsigned: the row says "you owe" or "you are owed" in words.
      minorUnits: (amount.amount < 0n
        ? -amount.amount
        : amount.amount
      ).toString(),
      currency: amount.currency,
    })),
  };
}

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

  const preferredCurrency = await getUserPreferredCurrency(user.userId);
  const { buckets } = await loadHomeOverview(user.userId, {
    preferredCurrency,
  });

  return [...buckets.needsYou, ...buckets.youAreOwed, ...buckets.settled]
    .sort(
      (a, b) =>
        b.group.lastActivityAt.getTime() - a.group.lastActivityAt.getTime(),
    )
    .map(toSwitcherGroup);
}
