import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/security/actor";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import {
  loadHomeOverview,
  type GroupPosition,
} from "@/modules/balances/overview";
import { defaultCurrency } from "@/modules/currencies/default-currency";
import { isGroupIcon, isGroupIconColor } from "@/modules/groups/icons";
import {
  ShareScreen,
  type ShareableGroup,
} from "@/components/share/share-screen";

/**
 * Where the manifest's share target lands.
 *
 * A GET screen, deliberately, even though a share arrives as a POST. The
 * worker in `src/app/sw.ts` takes the POST, puts what it holds in the device's
 * own store and redirects here — so this page is reloadable, leavable and
 * linkable, and the back button cannot re-submit a form.
 *
 * It renders the group list and nothing else the server can know: what was
 * shared never reaches the server at all. The photograph and the words sit in
 * IndexedDB until a group is chosen, which is what makes a shared receipt no
 * more exposed than a half-written draft.
 *
 * Archived groups are left out. Sharing into a group nobody is adding to any
 * more is a mis-tap with a write at the end of it, and the entry routes refuse
 * it anyway (`requireActive`) — better to not offer the row than to offer one
 * that fails after the upload.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("share");
  return { title: t("metaTitle") };
}

export default async function SharePage() {
  const user = await getCurrentUser();
  // The layout has already redirected when there is no user.
  if (!user) return null;

  const preferredCurrency = await getUserPreferredCurrency(user.userId);
  const { buckets } = await loadHomeOverview(user.userId, {
    preferredCurrency,
    now: new Date(),
  });

  const groups = [
    ...buckets.needsYou,
    ...buckets.youAreOwed,
    ...buckets.settled,
  ].map((position) => shareable(position, preferredCurrency));

  return <ShareScreen groups={groups} />;
}

function shareable(
  position: GroupPosition,
  preferred: string | null,
): ShareableGroup {
  const { group } = position;
  return {
    id: group.id,
    name: group.name,
    icon: isGroupIcon(group.icon) ? group.icon : null,
    iconColor: isGroupIconColor(group.iconColor) ? group.iconColor : null,
    /*
     * The same question the drawer answers when it opens, answered here
     * because the draft is written before the drawer ever runs — see
     * `defaultCurrency` for why a literal is the wrong answer to it. The
     * reader's own balances stand in for what the group actually spends in,
     * which is the signal a `separate` group has instead of a base currency.
     */
    currency: defaultCurrency({
      base: group.baseCurrency,
      used: position.amounts.map((amount) => ({
        currency: amount.currency,
        // The size of what the reader is owed or owes in that currency. A
        // settled group weighs every one of them at zero, and `mostUsedCurrency`
        // then keeps the first — still a better answer than a constant.
        weight: amount.amount < 0n ? -amount.amount : amount.amount,
      })),
      preferred,
    }),
  };
}
