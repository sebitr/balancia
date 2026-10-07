import "server-only";
import { oncePerRender } from "@/lib/render-memo";
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
 * Every group the reader can move to, and where they stand in each — the list
 * behind the desktop sidebar and the phone's group switcher.
 *
 * It is the home screen's read model, not a second one: `loadHomeOverview`
 * ranks the groups and `displayAmountsOf` picks the figures, so a group cannot
 * read one way on Home and another in the sidebar beside it.
 */

export interface NavigationGroup {
  readonly id: string;
  readonly name: string;
  readonly icon: GroupIcon | null;
  readonly iconColor: GroupIconColor | null;
  /** The section of Home the group sits under; "settled" when square. */
  readonly direction: PositionDirection;
  /**
   * The group's own figures, signed and unconverted, one per currency — the
   * figures Home shows for it. Signed because each is said on its own line
   * with its own direction: a group where the reader is owed euros and owes
   * francs reads "you are owed €248.00" and "you owe CHF 62.20", never one
   * verb for both. Empty when settled.
   */
  readonly amounts: readonly { minorUnits: string; currency: string }[];
  /** When money last moved in it, as ISO text — the chooser's order. */
  readonly lastActivityAt: string;
  /**
   * How many people are in it, which the chooser says on a desk. Optional
   * only so that a list built by hand can leave it out; this module always
   * fills it in.
   */
  readonly participantCount?: number;
}

function toNavigationGroup(position: GroupPosition): NavigationGroup {
  const { group } = position;
  return {
    id: group.id,
    name: group.name,
    icon: isGroupIcon(group.icon) ? group.icon : null,
    iconColor: isGroupIconColor(group.iconColor) ? group.iconColor : null,
    direction: directionOf(position),
    amounts: displayAmountsOf(position).map((amount) => ({
      minorUnits: amount.amount.toString(),
      currency: amount.currency,
    })),
    lastActivityAt: group.lastActivityAt.toISOString(),
    participantCount: group.participantCount,
  };
}

/**
 * The reader's groups in Home's order: the ones that need them, the ones that
 * owe them, then the settled ones, each section ranked as Home ranks it.
 *
 * Archived groups are left out, as they are everywhere but Home's own fold:
 * this list offers somewhere to go, and an archived group is not somewhere
 * anyone is going next.
 *
 * Memoised per request, because the sidebar asks for it from more than one
 * place in the same render.
 */
export const loadNavigationGroups = oncePerRender(
  async (userId: string): Promise<NavigationGroup[]> => {
    const preferredCurrency = await getUserPreferredCurrency(userId);
    const { buckets } = await loadHomeOverview(userId, { preferredCurrency });

    return [...buckets.needsYou, ...buckets.youAreOwed, ...buckets.settled].map(
      toNavigationGroup,
    );
  },
);
