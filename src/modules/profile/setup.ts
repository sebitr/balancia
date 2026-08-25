import "server-only";
import { getUserFavoriteCurrencies } from "@/modules/auth/service";
import { listPayoutMethods } from "@/modules/payouts/service";
import { listSubscriptions } from "@/modules/notifications/subscriptions";
import { getAvatarVersion } from "./avatar";

/**
 * What an account has already set up, for the screens that would ask again.
 *
 * The onboarding checklist used to assume the answer to all four of these was
 * "no". That is true of an account created two screens earlier and false of
 * every other kind of arrival — somebody who opened a group link already
 * signed in was shown a photo they had, a payout method they had entered and
 * currencies they had starred, all as things still to do. The list is a
 * receipt of what has happened, so it has to be able to read what already did.
 *
 * Deliberately four counts and a boolean rather than the profile itself: what
 * the caller needs to know is whether each row is finished, and the details
 * that come with the payout methods are here only because the sheet behind
 * that row opens on them for editing.
 */
export interface ProfileSetup {
  readonly hasPhoto: boolean;
  /** Starred currencies, in the account's own order. */
  readonly currencies: readonly string[];
  readonly payouts: readonly {
    readonly method: string;
    readonly detail: string;
  }[];
  /**
   * At least one device is registered for push.
   *
   * Account-wide rather than this-browser, because the question the row asks
   * is whether they have been asked before, and a subscription on any device
   * answers it. Turning push on *here* is still a tap inside the sheet.
   */
  readonly pushEnabled: boolean;
}

export async function loadProfileSetup(userId: string): Promise<ProfileSetup> {
  const [avatar, currencies, payouts, devices] = await Promise.all([
    getAvatarVersion(userId),
    getUserFavoriteCurrencies(userId),
    listPayoutMethods(userId),
    listSubscriptions(userId),
  ]);

  return {
    hasPhoto: avatar !== null,
    currencies,
    payouts: payouts.map((payout) => ({
      method: payout.method,
      detail: payout.detail,
    })),
    pushEnabled: devices.length > 0,
  };
}
